// Service catalog + request forms (P0-3, issue #51).
// Standardized intake forms (new laptop, access, password reset…) with
// dynamic form fields, auto-routing to the least-loaded AGENT, optional
// single-approver step (approval_required), one-click approve/reject.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    audit::write,
    db::AppState,
    models::{
        CatalogItem, CreateCatalogRequest, CreateRequestInput, ServiceRequest,
        UpdateCatalogRequest, UpdateRequestInput,
    },
};
use super::{notifications::notify, AppError};

pub fn router() -> Router<AppState> {
    // Catalog: reads for all, mutations ADMIN-only.
    // Requests: create for all authenticated users; approve/reassign/status
    // transitions for ADMIN/AGENT; requester can cancel own SUBMITTED request.
    Router::new()
        .route("/catalog", get(list_catalog))
        .route("/", get(list_requests).post(create_request))
        .route("/{id}", get(get_request).patch(update_request))
        .route("/{id}/approve", post(approve_request))
        .route("/{id}/reject", post(reject_request))
        .merge(
            Router::new()
                .route("/catalog", post(create_catalog_item))
                .route("/catalog/{id}", patch(update_catalog_item))
                .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin)),
        )
}

const REQUEST_SELECT: &str = "SELECT r.id, r.request_number, r.catalog_item_id, r.requester_id, \
    r.subject, r.details, r.priority, r.status, r.assignee_id, r.approved_by, r.approved_at, \
    r.created_at, r.updated_at, \
    u.name AS requester_name, a.name AS assignee_name, \
    c.name AS catalog_name, c.code AS catalog_code \
    FROM service_requests r \
    JOIN users u ON u.id = r.requester_id \
    LEFT JOIN users a ON a.id = r.assignee_id \
    JOIN request_catalog_items c ON c.id = r.catalog_item_id";

const CATALOG_SELECT: &str = "SELECT id, code, name, description, category, approval_required, \
    form_fields, active, sort_order, created_at, updated_at FROM request_catalog_items";

// ── catalog ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CatalogQuery {
    pub include_inactive: Option<bool>,
}

async fn list_catalog(
    State(state): State<AppState>,
    Query(q): Query<CatalogQuery>,
) -> Result<Json<Vec<CatalogItem>>, AppError> {
    let items = if q.include_inactive.unwrap_or(false) {
        sqlx::query_as::<_, CatalogItem>(&format!("{CATALOG_SELECT} ORDER BY sort_order, name"))
            .fetch_all(&state.pool)
            .await?
    } else {
        sqlx::query_as::<_, CatalogItem>(&format!("{CATALOG_SELECT} WHERE active = TRUE ORDER BY sort_order, name"))
            .fetch_all(&state.pool)
            .await?
    };
    Ok(Json(items))
}

async fn create_catalog_item(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateCatalogRequest>,
) -> Result<(StatusCode, Json<CatalogItem>), AppError> {
    let code = body.code.trim().to_uppercase().replace(' ', "_");
    let name = body.name.trim();
    if code.is_empty() || name.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "code and name are required"));
    }
    let item = sqlx::query_as::<_, CatalogItem>(
        "INSERT INTO request_catalog_items (code, name, description, category, approval_required, form_fields, active, sort_order) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         RETURNING id, code, name, description, category, approval_required, form_fields, active, sort_order, created_at, updated_at",
    )
    .bind(&code)
    .bind(name)
    .bind(body.description)
    .bind(if body.category.trim().is_empty() { "IT" } else { body.category.trim() })
    .bind(body.approval_required)
    .bind(body.form_fields)
    .bind(body.active)
    .bind(body.sort_order)
    .fetch_one(&state.pool)
    .await?;
    write(
        &state.pool,
        Some(actor_id),
        "CATALOG_CREATE",
        "request_catalog_item",
        item.id,
        json!({"code": code, "name": name, "approval_required": item.approval_required}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_catalog_item(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCatalogRequest>,
) -> Result<Json<CatalogItem>, AppError> {
    let current = sqlx::query_as::<_, (String, String)>(
        "SELECT code, name FROM request_catalog_items WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("catalog item not found"))?;

    let item = sqlx::query_as::<_, CatalogItem>(
        "UPDATE request_catalog_items SET \
            name = COALESCE($2, name), \
            description = CASE WHEN $3 THEN $4 ELSE COALESCE($4, description) END, \
            category = COALESCE($5, category), \
            approval_required = COALESCE($6, approval_required), \
            form_fields = COALESCE($7, form_fields), \
            active = COALESCE($8, active), \
            sort_order = COALESCE($9, sort_order), \
            updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, code, name, description, category, approval_required, form_fields, active, sort_order, created_at, updated_at",
    )
    .bind(id)
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.description.is_some())
    .bind(body.description.flatten())
    .bind(body.category.as_deref().map(|c| c.trim()))
    .bind(body.approval_required)
    .bind(body.form_fields)
    .bind(body.active)
    .bind(body.sort_order)
    .fetch_one(&state.pool)
    .await?;
    write(
        &state.pool,
        Some(actor_id),
        "CATALOG_UPDATE",
        "request_catalog_item",
        id,
        json!({"code": current.0, "name": current.1}),
    )
    .await?;
    Ok(Json(item))
}

// ── requests ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RequestQuery {
    pub mine: Option<bool>,
    pub status: Option<String>,
    pub assignee: Option<String>, // "me" | "unassigned" | uuid
    pub pending: Option<bool>,    // approval queue
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

async fn list_requests(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Query(q): Query<RequestQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let pool = &state.pool;
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;

    // Non-agents see only their own requests unless they explicitly ask for
    // pending approvals (approvers = ADMIN/AGENT can see the queue).
    let mut where_sql = String::from(" WHERE 1 = 1");
    let is_agent = role == "ADMIN" || role == "AGENT";
    let show_all = is_agent && q.mine != Some(true) && q.pending != Some(true);
    if !show_all && q.pending != Some(true) {
        where_sql.push_str(&format!(" AND r.requester_id = '{actor_id}'"));
    }
    if q.mine == Some(true) {
        where_sql.push_str(&format!(" AND r.requester_id = '{actor_id}'"));
    }
    if let Some(st) = q.status.as_deref() {
        if !matches!(st, "SUBMITTED" | "APPROVED" | "REJECTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
            return Err(AppError::new(StatusCode::BAD_REQUEST, "invalid status"));
        }
        where_sql.push_str(&format!(" AND r.status = '{st}'"));
    }
    if q.pending == Some(true) {
        // approval queue is agent-facing; non-agents get an empty list
        if !is_agent {
            return Ok((crate::pagination::total_header(0), Json(vec![])));
        }
        // SUBMITTED on approval-required catalog items
        where_sql.push_str(" AND r.status = 'SUBMITTED' AND c.approval_required = TRUE");
    }
    if let Some(a) = q.assignee.as_deref() {
        match a {
            "me" => where_sql.push_str(&format!(" AND r.assignee_id = '{actor_id}'")),
            "unassigned" => where_sql.push_str(" AND r.assignee_id IS NULL"),
            _ => where_sql.push_str(&format!(" AND r.assignee_id = '{a}'")),
        }
    }
    if let Some(s) = q.search.as_deref() {
        let pat = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        where_sql.push_str(&format!(
            " AND (r.request_number ILIKE '%{pat}%' ESCAPE '\\' OR r.subject ILIKE '%{pat}%' ESCAPE '\\' \
                 OR u.name ILIKE '%{pat}%' ESCAPE '\\' OR c.name ILIKE '%{pat}%' ESCAPE '\\')"
        ));
    }

    // Count query mirrors the data query's joins + WHERE (u/a/c are 1:1 so
    // COUNT(*) is exact).
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM service_requests r \
         JOIN users u ON u.id = r.requester_id \
         LEFT JOIN users a ON a.id = r.assignee_id \
         JOIN request_catalog_items c ON c.id = r.catalog_item_id{where_sql}"
    ))
    .fetch_one(pool)
    .await?;

    let mut sql = String::from(REQUEST_SELECT);
    sql.push_str(&where_sql);
    sql.push_str(" ORDER BY r.created_at DESC");
    let (limit, offset) = crate::pagination::page_params(q.limit, q.offset);
    let limit = limit.unwrap_or(100);
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    let requests = rows
        .iter()
        .map(|r| sqlx::FromRow::from_row(r).unwrap())
        .collect::<Vec<ServiceRequest>>();
    Ok((crate::pagination::total_header(total), Json(requests)))
}

async fn get_request(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let req: Option<ServiceRequest> =
        sqlx::query_as(&format!("{REQUEST_SELECT} WHERE r.id = $1"))
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(req) = req else {
        return Err(AppError::not_found("request not found"));
    };
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if req.requester_id != actor_id && !(role == "ADMIN" || role == "AGENT") {
        return Err(AppError::new(StatusCode::FORBIDDEN, "not your request"));
    }
    Ok(Json(json!({ "request": req })))
}

/// Auto-route: assign to the active AGENT with the fewest open requests.
async fn pick_agent(pool: &PgPool) -> Result<Option<Uuid>, sqlx::Error> {
    let agent: Option<(Uuid, i64)> = sqlx::query_as(
        "SELECT u.id, COUNT(sr.id)::bigint AS load FROM users u \
         LEFT JOIN service_requests sr ON sr.assignee_id = u.id \
             AND sr.status IN ('SUBMITTED', 'APPROVED', 'IN_PROGRESS') \
         WHERE u.role = 'AGENT' AND u.active = TRUE \
         GROUP BY u.id ORDER BY load ASC, u.name ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(agent.map(|(id, _)| id))
}

async fn create_request(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateRequestInput>,
) -> Result<(StatusCode, Json<ServiceRequest>), AppError> {
    let pool = &state.pool;
    let catalog = sqlx::query_as::<_, (String, bool)>(
        "SELECT name, approval_required FROM request_catalog_items WHERE id = $1 AND active = TRUE",
    )
    .bind(body.catalog_item_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("catalog item not found or inactive"))?;

    let subject = body.subject.trim();
    if subject.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "subject is required"));
    }
    let priority = body.priority.trim().to_uppercase();
    if !matches!(priority.as_str(), "LOW" | "MEDIUM" | "HIGH" | "URGENT") {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            "priority must be LOW, MEDIUM, HIGH or URGENT",
        ));
    }

    // Request number: REQ-YYYY-NNNN
    let seq: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM service_requests WHERE created_at >= date_trunc('year', NOW())",
    )
    .fetch_one(pool)
    .await?;
    let year = chrono::Utc::now().format("%Y");
    let request_number = format!("REQ-{year}-{:04}", seq + 1);

    let agent = pick_agent(pool).await?;
    let req = sqlx::query_as::<_, ServiceRequest>(
        "INSERT INTO service_requests \
            (request_number, catalog_item_id, requester_id, subject, details, priority, status, assignee_id) \
         VALUES ($1, $2, $3, $4, $5, $6, \
                 CASE WHEN $7 THEN 'SUBMITTED' ELSE 'APPROVED' END, \
                 $8) \
         RETURNING id, request_number, catalog_item_id, requester_id, subject, details, priority, status, \
                   assignee_id, approved_by, approved_at, created_at, updated_at, \
                   NULL::text AS requester_name, NULL::text AS assignee_name, \
                   NULL::text AS catalog_name, NULL::text AS catalog_code",
    )
    .bind(&request_number)
    .bind(body.catalog_item_id)
    .bind(actor_id)
    .bind(subject)
    .bind(body.details.unwrap_or_else(|| json!({})))
    .bind(priority.clone())
    .bind(catalog.1) // approval_required
    .bind(agent)
    .fetch_one(pool)
    .await?;

    // No approval needed → effectively pre-approved by the system.
    let status_note = if catalog.1 {
        "awaiting approval"
    } else {
        "auto-approved (no approval step), routed"
    };
    write(
        pool,
        Some(actor_id),
        "REQUEST_CREATE",
        "service_request",
        req.id,
        json!({"number": request_number, "catalog": catalog.0, "priority": priority, "status": req.status, "routed_to": agent.map(|a| a.to_string()).unwrap_or_else(|| "none".into())}),
    )
    .await?;

    // P1-2: notify the auto-routed agent
    if let Some(aid) = agent {
        notify(
            pool,
            aid,
            "REQUEST_ASSIGNED",
            &format!("New request: {}", subject),
            &format!("{} · {} · {} (assigned to you)", request_number, catalog.0, priority),
            "service_request",
            req.id,
        )
        .await;
    }

    let mut r = req;
    r.catalog_name = Some(catalog.0);
    if let Some(agent_id) = agent {
        let name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
            .bind(agent_id)
            .fetch_one(pool)
            .await?;
        r.assignee_name = Some(name);
    }
    let _ = status_note;
    Ok((StatusCode::CREATED, Json(r)))
}

async fn update_request(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRequestInput>,
) -> Result<Json<ServiceRequest>, AppError> {
    let pool = &state.pool;
    let current = sqlx::query_as::<_, (Uuid, String, Option<Uuid>)>(
        "SELECT requester_id, status, assignee_id FROM service_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("request not found"))?;
    let (requester_id, old_status, _) = current;

    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    let is_agent = role == "ADMIN" || role == "AGENT";

    if let Some(st) = body.status.as_deref() {
        if !matches!(st, "SUBMITTED" | "APPROVED" | "REJECTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
            return Err(AppError::new(StatusCode::BAD_REQUEST, "invalid status"));
        }
        // requester may only cancel their OWN request that is still awaiting
        // work (SUBMITTED/APPROVED) — never after work started or completed.
        if !is_agent {
            let allowed = actor_id == requester_id
                && st == "CANCELLED"
                && matches!(old_status.as_str(), "SUBMITTED" | "APPROVED");
            if !allowed {
                return Err(AppError::new(
                    StatusCode::FORBIDDEN,
                    "you may only cancel your own pending request",
                ));
            }
        }
    }
    if body.assignee_id.is_some() && !is_agent {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only agents can reassign"));
    }

    let req = sqlx::query_as::<_, ServiceRequest>(
        "UPDATE service_requests SET \
            subject = COALESCE($3, subject), \
            priority = COALESCE($4, priority), \
            assignee_id = CASE WHEN $5 THEN $6 ELSE COALESCE($6, assignee_id) END, \
            status = COALESCE($7, status), \
            updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, request_number, catalog_item_id, requester_id, subject, details, priority, status, \
                   assignee_id, approved_by, approved_at, created_at, updated_at, \
                   (SELECT name FROM users WHERE id = requester_id) AS requester_name, \
                   (SELECT name FROM users WHERE id = assignee_id) AS assignee_name, \
                   (SELECT name FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_name, \
                   (SELECT code FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_code",
    )
    .bind(id)
    .bind(actor_id)
    .bind(body.subject.as_deref().map(str::trim))
    .bind(body.priority.as_deref().map(|p| p.trim().to_uppercase()))
    .bind(body.assignee_id.is_some())
    .bind(body.assignee_id.flatten())
    .bind(body.status.clone())
    .fetch_one(pool)
    .await?;

    if let Some(st) = body.status.as_deref() {
        if st != old_status {
            write(
                pool,
                Some(actor_id),
                "REQUEST_STATUS",
                "service_request",
                id,
                json!({"number": req.request_number, "from": old_status, "to": st}),
            )
            .await?;
        }
    }
    Ok(Json(req))
}

async fn approve_request(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<Json<ServiceRequest>, AppError> {
    let pool = &state.pool;
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if role != "ADMIN" && role != "AGENT" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only agents can approve"));
    }
    let exists = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT r.request_number, r.status, c.approval_required FROM service_requests r \
         JOIN request_catalog_items c ON c.id = r.catalog_item_id WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("request not found"))?;
    if !exists.2 {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            "this catalog item does not require approval",
        ));
    }
    if exists.1 != "SUBMITTED" {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            format!("cannot approve request in state {}", exists.1),
        ));
    }

    let req = sqlx::query_as::<_, ServiceRequest>(
        "UPDATE service_requests SET status = 'APPROVED', approved_by = $2, approved_at = NOW(), updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, request_number, catalog_item_id, requester_id, subject, details, priority, status, \
                   assignee_id, approved_by, approved_at, created_at, updated_at, \
                   (SELECT name FROM users WHERE id = requester_id) AS requester_name, \
                   (SELECT name FROM users WHERE id = assignee_id) AS assignee_name, \
                   (SELECT name FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_name, \
                   (SELECT code FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_code",
    )
    .bind(id)
    .bind(actor_id)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "REQUEST_APPROVE",
        "service_request",
        id,
        json!({"number": exists.0}),
    )
    .await?;

    // P1-2: notify requester
    notify(
        pool,
        req.requester_id,
        "REQUEST_APPROVED",
        &format!("Request approved: {}", req.subject),
        &format!("{} was approved by {}.", req.request_number, req.approved_by.map(|_| "an agent").unwrap_or("an agent")),
        "service_request",
        req.id,
    )
    .await;

    Ok(Json(req))
}

async fn reject_request(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<Json<ServiceRequest>, AppError> {
    let pool = &state.pool;
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if role != "ADMIN" && role != "AGENT" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only agents can reject"));
    }
    let number =
        sqlx::query_as::<_, (String, String)>("SELECT request_number, status FROM service_requests WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("request not found"))?;
    if number.1 != "SUBMITTED" {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            format!("cannot reject request in state {}", number.1),
        ));
    }

    let req = sqlx::query_as::<_, ServiceRequest>(
        "UPDATE service_requests SET status = 'REJECTED', approved_by = $2, approved_at = NOW(), updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, request_number, catalog_item_id, requester_id, subject, details, priority, status, \
                   assignee_id, approved_by, approved_at, created_at, updated_at, \
                   (SELECT name FROM users WHERE id = requester_id) AS requester_name, \
                   (SELECT name FROM users WHERE id = assignee_id) AS assignee_name, \
                   (SELECT name FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_name, \
                   (SELECT code FROM request_catalog_items WHERE id = catalog_item_id) AS catalog_code",
    )
    .bind(id)
    .bind(actor_id)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "REQUEST_REJECT",
        "service_request",
        id,
        json!({"number": number.0}),
    )
    .await?;

    // P1-2: notify requester
    notify(
        pool,
        req.requester_id,
        "REQUEST_REJECTED",
        &format!("Request rejected: {}", req.subject),
        &format!("{} was rejected.", req.request_number),
        "service_request",
        req.id,
    )
    .await;

    Ok(Json(req))
}

// ── dashboard metric: open requests ─────────────────────────────────────────

pub async fn open_request_count(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM service_requests WHERE status IN ('SUBMITTED', 'APPROVED', 'IN_PROGRESS')",
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}
