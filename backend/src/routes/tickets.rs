use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, QueryBuilder};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{CreateTicketRequest, Ticket, UpdateTicketRequest, UpdateTicketStatusRequest};

use super::{notifications::notify, AppError};

/// Shared joined SELECT for enriched ticket rows.
const TICKET_SELECT: &str = "SELECT t.id, t.ticket_number, t.title, t.description, \
     t.ticket_type, t.priority, t.status, t.source, t.requester_id, t.assignee_id, t.asset_id, \
     t.created_at, t.updated_at, t.sla_due_at, t.sla_escalated_at, \
     r.name AS requester_name, a2.name AS assignee_name, a.asset_tag, a.name AS asset_name \
     FROM tickets t \
     LEFT JOIN users r  ON r.id  = t.requester_id \
     LEFT JOIN users a2 ON a2.id = t.assignee_id \
     LEFT JOIN assets a ON a.id  = t.asset_id";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_tickets).post(create_ticket))
        .route("/{id}", get(get_ticket).patch(update_ticket))
        .route("/{id}/status", patch(update_ticket_status))
        .route("/export", get(export_tickets))
}

#[derive(Debug, Deserialize)]
pub struct TicketListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub overdue: Option<bool>,
    #[serde(rename = "type")]
    pub ticket_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub search: Option<String>,
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

/// Normalize a raw ticket-type filter/body value: trim + uppercase, default
/// INCIDENT, legacy "REQUEST" → "SERVICE_REQUEST".
pub fn normalize_ticket_type(raw: Option<&str>) -> String {
    let upper = raw.unwrap_or("INCIDENT").trim().to_uppercase();
    if upper.is_empty() {
        return "INCIDENT".to_string();
    }
    if upper == "REQUEST" {
        return "SERVICE_REQUEST".to_string();
    }
    upper
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
        let normalized = normalize_ticket_type(Some(ticket_type));
        if normalized == "SERVICE_REQUEST" {
            // Match historical 'REQUEST' rows too.
            qb.push("t.ticket_type IN ('SERVICE_REQUEST', 'REQUEST')");
            cqb.push("t.ticket_type IN ('SERVICE_REQUEST', 'REQUEST')");
        } else {
            qb.push("t.ticket_type = ").push_bind(normalized.clone());
            cqb.push("t.ticket_type = ").push_bind(normalized);
        }
        any = true;
    }
    if params.overdue == Some(true) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW() AND t.status IN ('OPEN', 'IN_PROGRESS')");
        cqb.push("t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW() AND t.status IN ('OPEN', 'IN_PROGRESS')");
        any = true;
    }
    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        let pat = format!("%{search}%");
        qb.push("(t.title ILIKE ").push_bind(pat.clone());
        qb.push(" OR t.ticket_number ILIKE ").push_bind(pat.clone());
        qb.push(" OR t.description ILIKE ").push_bind(pat.clone());
        qb.push(")");
        cqb.push("(t.title ILIKE ").push_bind(pat.clone());
        cqb.push(" OR t.ticket_number ILIKE ").push_bind(pat.clone());
        cqb.push(" OR t.description ILIKE ").push_bind(pat);
        cqb.push(")");
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
    let (limit, offset) = crate::pagination::page_params(params.limit, params.offset);
    crate::pagination::push_pagination(&mut qb, limit, offset);

    let tickets = qb.build_query_as::<Ticket>().fetch_all(&state.pool).await?;
    let total: i64 = if limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        tickets.len() as i64
    };
    Ok((crate::pagination::total_header(total), Json(tickets)))
}

/// GET /api/v1/tickets/{id} — enriched single ticket row.
async fn get_ticket(
    State(state): State<AppState>,
    Path(ticket_id): Path<Uuid>,
) -> Result<Json<Ticket>, AppError> {
    let ticket: Option<Ticket> =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_optional(&state.pool)
            .await?;
    match ticket {
        Some(ticket) => Ok(Json(ticket)),
        None => Err(AppError::not_found("ticket not found")),
    }
}

/// POST /api/v1/tickets → 201 with auto-generated INC-XXXX tag + audit row.
async fn create_ticket(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateTicketRequest>,
) -> Result<(StatusCode, Json<Ticket>), AppError> {
    if body.title.trim().is_empty() {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "title is required"));
    }
    let requester_id = body.requester_id.unwrap_or(actor_id);

    let requester_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(requester_id)
            .fetch_one(&state.pool)
            .await?;
    if !requester_exists {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "requester not found"));
    }
    if let Some(aid) = body.assignee_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(aid)
            .fetch_one(&state.pool)
            .await?;
        if !exists {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "assignee not found"));
        }
    }
    if let Some(asid) = body.asset_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)")
            .bind(asid)
            .fetch_one(&state.pool)
            .await?;
        if !exists {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "asset not found"));
        }
    }

    let inserted = insert_ticket_with_number_retry(&state.pool, &body, requester_id, "PORTAL").await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TICKET_CREATE', 'ticket', $2, $3)",
    )
    .bind(actor_id)
    .bind(inserted.id)
    .bind(json!({
        "old": {},
        "new": {
            "ticket_number": &inserted.ticket_number,
            "title": &inserted.title,
            "ticket_type": &inserted.ticket_type,
            "priority": &inserted.priority,
            "status": &inserted.status,
            "requester_id": inserted.requester_id,
            "assignee_id": inserted.assignee_id,
            "asset_id": inserted.asset_id,
        }
    }))
    .execute(&state.pool)
    .await?;

    // P1-4: SLA deadline from creation time
    super::sla::set_sla_due(&state.pool, inserted.id, &inserted.priority, "OPEN", inserted.created_at).await?;

    // Re-fetch the enriched row so names + sla_due_at are populated.
    let ticket: Ticket = sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
        .bind(inserted.id)
        .fetch_one(&state.pool)
        .await?;

    // P1-2: notify the assignee when a ticket is created pre-assigned
    if let Some(aid) = ticket.assignee_id {
        notify(
            &state.pool,
            aid,
            "TICKET_ASSIGNED",
            "New ticket assigned to you",
            &format!("{} · {} — {}", ticket.ticket_number, ticket.title, ticket.priority),
            "ticket",
            ticket.id,
        )
        .await;
    }

    Ok((StatusCode::CREATED, Json(ticket)))
}

/// PATCH /api/v1/tickets/{id}/status — whitelisted transitions only.
async fn update_ticket_status(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(ticket_id): Path<Uuid>,
    Json(body): Json<UpdateTicketStatusRequest>,
) -> Result<Json<Ticket>, AppError> {
    let current: Option<(String, String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT status, priority, created_at FROM tickets WHERE id = $1")
            .bind(ticket_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((old_status, old_priority, old_created_at)) = current else {
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

    // P1-4: SLA clock runs while OPEN/IN_PROGRESS, stops when closed
    super::sla::set_sla_due(&state.pool, ticket_id, &old_priority, &body.status, old_created_at).await?;

    let updated: Ticket =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TICKET_STATUS', 'ticket', $2, $3)",
    )
    .bind(actor_id)
    .bind(ticket_id)
    .bind(json!({ "from": old_status, "to": body.status }))
    .execute(&state.pool)
    .await?;

    // P1-2: status change → notify requester + assignee
    let requester = updated.requester_id;
    notify(
        &state.pool,
        requester,
        "TICKET_STATUS",
        &format!("{} → {}", updated.ticket_number, body.status.replace('_', " ")),
        &format!(
            "Status of {} changed from {} to {}",
            updated.title, old_status.replace('_', " "), body.status.replace('_', " ")
        ),
        "ticket",
        ticket_id,
    )
    .await;
    if let Some(assignee) = updated.assignee_id {
        if assignee != requester {
            notify(
                &state.pool,
                assignee,
                "TICKET_STATUS",
                &format!("{} → {}", updated.ticket_number, body.status.replace('_', " ")),
                &format!(
                    "Status of {} changed from {} to {}",
                    updated.title, old_status.replace('_', " "), body.status.replace('_', " ")
                ),
                "ticket",
                ticket_id,
            )
            .await;
        }
    }

    Ok(Json(updated))
}

/// PATCH /api/v1/tickets/{id} — update priority / assignee / asset.
async fn update_ticket(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(ticket_id): Path<Uuid>,
    Json(body): Json<UpdateTicketRequest>,
) -> Result<Json<Ticket>, AppError> {
    let current: Option<(
        String,
        String,
        Option<Uuid>,
        Option<Uuid>,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        "SELECT status, priority, assignee_id, asset_id, created_at FROM tickets WHERE id = $1",
    )
    .bind(ticket_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((old_status, old_priority, old_assignee, old_asset, old_created_at)) = current else {
        return Err(AppError::not_found("ticket not found"));
    };

    let new_priority = body.priority.clone().unwrap_or_else(|| old_priority.clone());
    if !["LOW", "MEDIUM", "HIGH", "URGENT"].contains(&new_priority.as_str()) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid priority: {new_priority}"),
        ));
    }

    let new_assignee = match body.assignee_id {
        Some(v) => v,
        None => old_assignee,
    };
    if let Some(aid) = new_assignee {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(aid)
            .fetch_one(&state.pool)
            .await?;
        if !exists {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "assignee not found"));
        }
    }

    let new_asset = match body.asset_id {
        Some(v) => v,
        None => old_asset,
    };
    if let Some(asid) = new_asset {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)")
            .bind(asid)
            .fetch_one(&state.pool)
            .await?;
        if !exists {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "asset not found"));
        }
    }

    sqlx::query("UPDATE tickets SET priority = $2, assignee_id = $3, asset_id = $4, updated_at = NOW() WHERE id = $1")
        .bind(ticket_id)
        .bind(&new_priority)
        .bind(new_assignee)
        .bind(new_asset)
        .execute(&state.pool)
        .await?;

    if new_priority != old_priority {
        super::sla::set_sla_due(&state.pool, ticket_id, &new_priority, &old_status, old_created_at).await?;
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_PRIORITY', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(json!({ "from": old_priority, "to": new_priority }))
        .execute(&state.pool)
        .await?;
    }

    let updated: Ticket =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    if new_assignee != old_assignee {
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_ASSIGN', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(json!({ "assignee_id": new_assignee, "assignee_name": updated.assignee_name }))
        .execute(&state.pool)
        .await?;
        if let Some(aid) = new_assignee {
            notify(
                &state.pool,
                aid,
                "TICKET_ASSIGNED",
                "Ticket assigned to you",
                &format!("{} · {} — {}", updated.ticket_number, updated.title, updated.priority),
                "ticket",
                ticket_id,
            )
            .await;
        }
    }

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

/// Ticket number generation: MAX(numeric suffix) + 1 → `INC-{:04}`,
/// retrying on unique-violation races.
pub async fn allocate_next_ticket_number(pool: &PgPool) -> Result<String, AppError> {
    let next_num: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX((substring(ticket_number FROM '([0-9]+)$'))::bigint), COUNT(*)) + 1 FROM tickets",
    )
    .fetch_one(pool)
    .await?;
    Ok(format!("INC-{:04}", next_num))
}

async fn insert_ticket_with_number_retry(
    pool: &PgPool,
    body: &CreateTicketRequest,
    requester_id: Uuid,
    source: &str,
) -> Result<Ticket, AppError> {
    let ticket_type = normalize_ticket_type(body.ticket_type.as_deref());
    let priority = body.priority.clone().unwrap_or_else(|| "MEDIUM".to_string());

    for attempt in 0..10 {
        let base = allocate_next_ticket_number(pool).await?;
        let ticket_number = if attempt > 0 {
            // Re-query already gives the fresh max; add the attempt offset as a
            // belt-and-braces guard against a tight concurrent-alloc race.
            let n: i64 = base
                .trim_start_matches("INC-")
                .parse()
                .unwrap_or(1);
            format!("INC-{:04}", n + attempt as i64)
        } else {
            base
        };

        let result = sqlx::query_as::<_, Ticket>(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, \
                source, requester_id, assignee_id, asset_id) \
             VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $9) \
             RETURNING id, ticket_number, title, description, ticket_type, priority, status, source, \
                requester_id, assignee_id, asset_id, created_at, updated_at, \
                NULL::timestamptz AS sla_due_at, NULL::timestamptz AS sla_escalated_at, \
                NULL::text AS requester_name, NULL::text AS assignee_name, \
                NULL::text AS asset_tag, NULL::text AS asset_name",
        )
        .bind(&ticket_number)
        .bind(&body.title)
        .bind(&body.description)
        .bind(&ticket_type)
        .bind(&priority)
        .bind(source)
        .bind(requester_id)
        .bind(body.assignee_id)
        .bind(body.asset_id)
        .fetch_one(pool)
        .await;

        match result {
            Ok(ticket) => return Ok(ticket),
            Err(sqlx::Error::Database(db_err))
                if db_err.is_unique_violation()
                    && db_err.constraint() == Some("tickets_ticket_number_key")
                    && attempt < 9 =>
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

fn csv_err(e: csv::Error) -> AppError {
    AppError::new(StatusCode::BAD_REQUEST, format!("csv error: {e}"))
}

/// GET /api/v1/tickets/export?status=&priority=&type= — CSV download of the
/// filtered ticket list (mirrors list_tickets filters; capped at 10k rows).
async fn export_tickets(
    State(state): State<AppState>,
    Query(params): Query<TicketListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut qb = QueryBuilder::new(TICKET_SELECT);
    qb.push(" WHERE ");
    let mut any = false;
    if let Some(status) = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        any = true;
        qb.push("t.status = ").push_bind(status);
    }
    if let Some(priority) = params.priority.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
        }
        qb.push("t.priority = ").push_bind(priority);
        any = true;
    }
    if let Some(ticket_type) = params
        .ticket_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if any {
            qb.push(" AND ");
        }
        let normalized = normalize_ticket_type(Some(ticket_type));
        if normalized == "SERVICE_REQUEST" {
            // Match historical 'REQUEST' rows too.
            qb.push("t.ticket_type IN ('SERVICE_REQUEST', 'REQUEST')");
        } else {
            qb.push("t.ticket_type = ").push_bind(normalized);
        }
        any = true;
    }
    if params.overdue == Some(true) {
        if any {
            qb.push(" AND ");
        }
        qb.push("t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW() AND t.status IN ('OPEN', 'IN_PROGRESS')");
        any = true;
    }
    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
        }
        let pat = format!("%{search}%");
        qb.push("(t.title ILIKE ").push_bind(pat.clone());
        qb.push(" OR t.ticket_number ILIKE ").push_bind(pat.clone());
        qb.push(" OR t.description ILIKE ").push_bind(pat);
        qb.push(")");
        any = true;
    }
    if !any {
        qb.push("1 = 1");
    }
    qb.push(" ORDER BY ")
        .push(ticket_sort(params.sort.as_deref().unwrap_or("created_at")));
    if params.order.as_deref() == Some("asc") {
        qb.push(" ASC");
    } else {
        qb.push(" DESC");
    }
    qb.push(", t.created_at DESC");
    qb.push(" LIMIT 10000");

    let tickets = qb.build_query_as::<Ticket>().fetch_all(&state.pool).await?;

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record([
        "ticket_number",
        "title",
        "description",
        "ticket_type",
        "priority",
        "status",
        "requester",
        "assignee",
        "asset_tag",
        "asset_name",
        "created_at",
        "updated_at",
    ])
    .map_err(csv_err)?;
    for t in &tickets {
        wtr.write_record(vec![
            crate::routes::csv_safe(&t.ticket_number),
            crate::routes::csv_safe(&t.title),
            crate::routes::csv_safe(&t.description),
            crate::routes::csv_safe(&t.ticket_type),
            crate::routes::csv_safe(&t.priority),
            crate::routes::csv_safe(&t.status),
            crate::routes::csv_safe(&t.requester_name.clone().unwrap_or_default()),
            crate::routes::csv_safe(&t.assignee_name.clone().unwrap_or_default()),
            crate::routes::csv_safe(&t.asset_tag.clone().unwrap_or_default()),
            crate::routes::csv_safe(&t.asset_name.clone().unwrap_or_default()),
            t.created_at.to_rfc3339(),
            t.updated_at.to_rfc3339(),
        ])
        .map_err(csv_err)?;
    }
    let body = wtr
        .into_inner()
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("csv write error: {}", e.into_error())))?;

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"tickets.csv\"",
            ),
        ],
        body,
    ))
}
