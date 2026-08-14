use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, QueryBuilder};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{CreateTicketRequest, Ticket, UpdateTicketStatusRequest};

use super::AppError;

/// Shared joined SELECT for enriched ticket rows.
const TICKET_SELECT: &str = "SELECT t.id, t.ticket_number, t.title, t.description, \
     t.ticket_type, t.priority, t.status, t.requester_id, t.assignee_id, t.asset_id, \
     t.created_at, t.updated_at, \
     r.name AS requester_name, a2.name AS assignee_name, a.asset_tag, a.name AS asset_name \
     FROM tickets t \
     LEFT JOIN users r  ON r.id  = t.requester_id \
     LEFT JOIN users a2 ON a2.id = t.assignee_id \
     LEFT JOIN assets a ON a.id  = t.asset_id";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_tickets).post(create_ticket))
        .route("/{id}/status", patch(update_ticket_status))
}

#[derive(Debug, Deserialize)]
pub struct TicketListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    #[serde(rename = "type")]
    pub ticket_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

/// Whitelisted ORDER BY columns. Priority sorts semantically
/// (URGENT > HIGH > MEDIUM > LOW), not alphabetically.
fn ticket_sort(col: &str) -> &'static str {
    match col {
        "ticket_number" => "t.ticket_number",
        "title" => "t.title",
        "status" => "t.status",
        "ticket_type" => "t.ticket_type",
        "updated_at" => "t.updated_at",
        "priority" => "CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END",
        _ => "t.created_at",
    }
}

/// GET /api/v1/tickets?status=&priority=&type=
async fn list_tickets(
    State(state): State<AppState>,
    Query(params): Query<TicketListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut qb = QueryBuilder::new(TICKET_SELECT);
    let mut cqb = QueryBuilder::new("SELECT COUNT(*) FROM tickets t");
    qb.push(" WHERE ");
    cqb.push(" WHERE ");
    let mut any = false;

    if let Some(status) = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("t.status = ").push_bind(status.clone());
        cqb.push("t.status = ").push_bind(status.clone());
        any = true;
    }
    if let Some(priority) = params.priority.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("t.priority = ").push_bind(priority.clone());
        cqb.push("t.priority = ").push_bind(priority.clone());
        any = true;
    }
    if let Some(ticket_type) = params.ticket_type.as_deref().map(str::trim).filter(|s| !s.is_empty())
    {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("t.ticket_type = ").push_bind(ticket_type.clone());
        cqb.push("t.ticket_type = ").push_bind(ticket_type.clone());
        any = true;
    }
    if !any {
        qb.push("1 = 1");
        cqb.push("1 = 1");
    }

    qb.push(" ORDER BY ").push(ticket_sort(params.sort.as_deref().unwrap_or("created_at")));
    if params.order.as_deref() == Some("asc") {
        qb.push(" ASC");
    } else {
        qb.push(" DESC");
    }
    qb.push(", t.created_at DESC");
    if let Some(limit) = params.limit {
        qb.push(" LIMIT ").push_bind(limit.clamp(1, 1000));
        if let Some(offset) = params.offset {
            qb.push(" OFFSET ").push_bind(offset.max(0));
        }
    }

    let tickets = qb.build_query_as::<Ticket>().fetch_all(&state.pool).await?;
    let total: i64 = if params.limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        tickets.len() as i64
    };
    Ok(([("x-total-count", total.to_string())], Json(tickets)))
}

/// POST /api/v1/tickets → 201 with auto-generated INC-XXXX tag + audit row.
async fn create_ticket(
    State(state): State<AppState>,
    Json(body): Json<CreateTicketRequest>,
) -> Result<(StatusCode, Json<Ticket>), AppError> {
    let ticket = insert_ticket_with_number_retry(&state.pool, &body).await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'TICKET_CREATE', 'ticket', $1, $2)",
    )
    .bind(ticket.id)
    .bind(json!({
        "old": {},
        "new": {
            "ticket_number": &ticket.ticket_number,
            "title": &ticket.title,
            "ticket_type": &ticket.ticket_type,
            "priority": &ticket.priority,
            "status": &ticket.status,
            "requester_id": ticket.requester_id,
            "assignee_id": ticket.assignee_id,
            "asset_id": ticket.asset_id,
        }
    }))
    .execute(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(ticket)))
}

/// PATCH /api/v1/tickets/{id}/status — whitelisted transitions only.
async fn update_ticket_status(
    State(state): State<AppState>,
    Path(ticket_id): Path<Uuid>,
    Json(body): Json<UpdateTicketStatusRequest>,
) -> Result<Json<Ticket>, AppError> {
    let current: Option<(String,)> = sqlx::query_as("SELECT status FROM tickets WHERE id = $1")
        .bind(ticket_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((old_status,)) = current else {
        return Err(AppError::not_found("ticket not found"));
    };

    if !allowed_transitions(&old_status).contains(&body.status.as_str()) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("illegal status transition: {old_status} -> {}", body.status),
        ));
    }

    sqlx::query("UPDATE tickets SET status = $2, updated_at = NOW() WHERE id = $1")
        .bind(ticket_id)
        .bind(&body.status)
        .execute(&state.pool)
        .await?;

    let updated: Ticket =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'TICKET_STATUS', 'ticket', $1, $2)",
    )
    .bind(ticket_id)
    .bind(json!({ "from": old_status, "to": body.status }))
    .execute(&state.pool)
    .await?;

    Ok(Json(updated))
}

/// Status transition whitelist: OPEN→[IN_PROGRESS,CLOSED], IN_PROGRESS→[RESOLVED,OPEN],
/// RESOLVED→[CLOSED,OPEN], CLOSED→[OPEN].
fn allowed_transitions(from: &str) -> &'static [&'static str] {
    match from {
        "OPEN" => &["IN_PROGRESS", "CLOSED"],
        "IN_PROGRESS" => &["RESOLVED", "OPEN"],
        "RESOLVED" => &["CLOSED", "OPEN"],
        "CLOSED" => &["OPEN"],
        _ => &[],
    }
}

/// Ticket number generation: `SELECT count(*) FROM tickets` + 1 → `INC-{:04}`,
/// retrying on unique-violation races.
async fn insert_ticket_with_number_retry(
    pool: &PgPool,
    body: &CreateTicketRequest,
) -> Result<Ticket, AppError> {
    let ticket_type = body.ticket_type.clone().unwrap_or_else(|| "INCIDENT".to_string());
    let priority = body.priority.clone().unwrap_or_else(|| "MEDIUM".to_string());

    for attempt in 0..3 {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tickets")
            .fetch_one(pool)
            .await?;
        let ticket_number = format!("INC-{:04}", count + 1);

        let result = sqlx::query_as::<_, Ticket>(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, \
                requester_id, assignee_id, asset_id) \
             VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8) \
             RETURNING id, ticket_number, title, description, ticket_type, priority, status, \
                requester_id, assignee_id, asset_id, created_at, updated_at, \
                NULL::text AS requester_name, NULL::text AS assignee_name, \
                NULL::text AS asset_tag, NULL::text AS asset_name",
        )
        .bind(&ticket_number)
        .bind(&body.title)
        .bind(&body.description)
        .bind(&ticket_type)
        .bind(&priority)
        .bind(body.requester_id)
        .bind(body.assignee_id)
        .bind(body.asset_id)
        .fetch_one(pool)
        .await;

        match result {
            Ok(ticket) => return Ok(ticket),
            Err(sqlx::Error::Database(db_err))
                if db_err.is_unique_violation()
                    && db_err.constraint() == Some("tickets_ticket_number_key")
                    && attempt < 2 =>
            {
                tracing::warn!("ticket number {ticket_number} collided, retrying");
                continue;
            }
            Err(err) => return Err(err.into()),
        }
    }

    Err(AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate a unique ticket number",
    ))
}
