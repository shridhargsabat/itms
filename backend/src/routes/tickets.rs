use axum::extract::{Extension, Query, State};
use axum::http::{header, StatusCode};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{CreateTicketRequest, Ticket, UpdateTicketRequest, UpdateTicketStatusRequest};

use super::{notifications::notify, AppError, UuidPath};

/// Shared joined SELECT for enriched ticket rows.
const TICKET_SELECT: &str = "SELECT t.id, t.ticket_number, t.title, t.description, \
     t.ticket_type, t.priority, t.status, t.source, t.requester_id, t.assignee_id, t.asset_id, \
     t.created_at, t.updated_at, t.sla_due_at, t.sla_escalated_at, \
     r.name AS requester_name, a2.name AS assignee_name, a.asset_tag, a.name AS asset_name \
     FROM tickets t \
     LEFT JOIN users r  ON r.id  = t.requester_id \
     LEFT JOIN users a2 ON a2.id = t.assignee_id \
     LEFT JOIN assets a ON a.id  = t.asset_id";

/// Canonical allowlists — mirror migration 0026 CHECKs exactly. Handlers
/// validate pre-insert (422); the DB constraints are the backstop.
pub const ALLOWED_PRIORITIES: &[&str] = &["LOW", "MEDIUM", "HIGH", "URGENT"];
pub const ALLOWED_STATUSES: &[&str] = &["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
/// Masters ticket_type (INCIDENT/SERVICE_REQUEST/CHANGE) + the extra values
/// the shipped New-Ticket form offers (PROBLEM/ACCESS/OTHER).
pub const ALLOWED_TICKET_TYPES: &[&str] = &[
    "INCIDENT",
    "SERVICE_REQUEST",
    "CHANGE",
    "PROBLEM",
    "ACCESS",
    "OTHER",
];
/// Sortable list keys (TBE-19: unknown keys are 422, not silent created_at).
const ALLOWED_SORTS: &[&str] = &[
    "ticket_number",
    "title",
    "status",
    "ticket_type",
    "updated_at",
    "priority",
    "created_at",
    // UX-12 (#186): sibling Tickets.tsx writes ?sort=sla_due_at — the key name
    // is a cross-file contract, keep it exactly.
    "sla_due_at",
];
/// Title mirrors VARCHAR(255) (TBE-10: overlong → 422, never 500).
pub const MAX_TITLE_CHARS: usize = 255;
/// TBE-16: bounded default page; `limit=all` opts back into unlimited.
pub const DEFAULT_LIST_LIMIT: i64 = 100;
pub const MAX_LIST_LIMIT: i64 = 500;
/// TBE-11: search pattern cap (chars, before wildcard wrapping).
pub const MAX_SEARCH_CHARS: usize = 200;

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
    /// Overdue as raw text ("true"/"false"/"1"/"0"): parsed manually so
    /// `?overdue=maybe` is a 422 with a message, not axum's bare 400
    /// (R2-BE-14 #161 — tickets-limit pattern).
    pub overdue: Option<String>,
    #[serde(rename = "type")]
    pub ticket_type: Option<String>,
    /// Page size as raw text: integer, or "all" for the explicit unlimited
    /// escape hatch (TBE-16). Parsed manually so garbage is a 422 with a
    /// message instead of axum's bare 400.
    pub limit: Option<String>,
    pub offset: Option<String>,
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
        "sla_due_at" => "t.sla_due_at",
        _ => "t.created_at",
    }
}

/// TBE-19: unknown sort keys are 422 (matched case-insensitively); absent →
/// created_at (existing default).
fn parse_sort_key(raw: Option<&str>) -> Result<&'static str, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok("t.created_at"),
        Some(s) => {
            let lower = s.to_lowercase();
            if ALLOWED_SORTS.contains(&lower.as_str()) {
                Ok(ticket_sort(&lower))
            } else {
                Err(AppError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("invalid sort: {s} (expected one of: {})", ALLOWED_SORTS.join(", ")),
                ))
            }
        }
    }
}

/// TBE-19: order is asc/desc (case-insensitive); absent → DESC (existing
/// default). Anything else is 422, not silent DESC.
fn parse_order_asc(raw: Option<&str>) -> Result<bool, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(false),
        Some(s) if s.eq_ignore_ascii_case("asc") => Ok(true),
        Some(s) if s.eq_ignore_ascii_case("desc") => Ok(false),
        Some(s) => Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid order: {s} (expected asc or desc)"),
        )),
    }
}

/// ORDER BY builder shared by list + export so the two can't drift.
/// Nullable sort keys (sla_due_at — UX-12 #186) sort NULLS LAST in BOTH
/// directions so tickets without a deadline sink to the end instead of
/// topping the list; every other key keeps the bare ASC/DESC. The trailing
/// `t.created_at DESC` is the long-standing stable tiebreak.
fn push_order_by(qb: &mut QueryBuilder<'_, Postgres>, sort_sql: &str, asc: bool) {
    qb.push(" ORDER BY ").push(sort_sql);
    qb.push(if asc { " ASC" } else { " DESC" });
    if sort_sql == "t.sla_due_at" {
        qb.push(" NULLS LAST");
    }
    qb.push(", t.created_at DESC");
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

/// TBE-01: priority allowlist (trim + uppercase, then strict) → 422.
pub fn validate_priority(raw: &str) -> Result<String, AppError> {
    let upper = raw.trim().to_uppercase();
    if ALLOWED_PRIORITIES.contains(&upper.as_str()) {
        Ok(upper)
    } else {
        Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "invalid priority: {} (expected one of: {})",
                raw.trim(),
                ALLOWED_PRIORITIES.join(", ")
            ),
        ))
    }
}

/// TBE-02: ticket-type allowlist (normalize, then strict) → 422.
/// None → INCIDENT (existing create default).
pub fn validate_ticket_type(raw: Option<&str>) -> Result<String, AppError> {
    let normalized = normalize_ticket_type(raw);
    if ALLOWED_TICKET_TYPES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "invalid ticket_type: {normalized} (expected one of: {})",
                ALLOWED_TICKET_TYPES.join(", ")
            ),
        ))
    }
}

/// R2-BE-11 (#144): ticket-type on UPDATE — None stays unchanged, but a
/// present-but-blank value is 422 (normalize maps '' → INCIDENT, which used
/// to silently reset e.g. CHANGE tickets to INCIDENT on PATCH).
pub fn validate_ticket_type_update(raw: Option<&str>) -> Result<Option<String>, AppError> {
    match raw {
        None => Ok(None),
        Some(t) if t.trim().is_empty() => Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ticket_type must not be empty",
        )),
        Some(t) => Ok(Some(validate_ticket_type(Some(t))?)),
    }
}

/// Single status value: trim + uppercase, then strict → 422.
pub fn validate_status_value(raw: &str) -> Result<String, AppError> {
    let upper = raw.trim().to_uppercase();
    if ALLOWED_STATUSES.contains(&upper.as_str()) {
        Ok(upper)
    } else {
        Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "invalid status: {} (expected one of: {})",
                raw.trim(),
                ALLOWED_STATUSES.join(", ")
            ),
        ))
    }
}

/// C2: comma-separated multi-status (`status=OPEN,IN_PROGRESS`), each value
/// normalized + validated → 422 on the first garbage entry.
fn parse_status_filter(raw: &str) -> Result<Vec<String>, AppError> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(validate_status_value)
        .collect()
}

/// R2-BE-14 (#161): `?overdue=` accepts true/false/1/0 (case-insensitive
/// for the words); absent/blank → false (no filter). Anything else is 422.
fn parse_overdue_filter(raw: Option<&str>) -> Result<bool, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(false),
        Some(s) if s.eq_ignore_ascii_case("true") || s == "1" => Ok(true),
        Some(s) if s.eq_ignore_ascii_case("false") || s == "0" => Ok(false),
        Some(s) => Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid overdue: {s} (expected true, false, 1 or 0)"),
        )),
    }
}

/// TBE-16: default cap 100; explicit `limit=all` restores unlimited;
/// integers clamp to [1, 500]. Zero/negative/garbage → 422 (TBE-20: no more
/// silent clamp-to-1).
fn parse_list_limit(raw: Option<&str>) -> Result<Option<i64>, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(Some(DEFAULT_LIST_LIMIT)),
        Some(s) if s.eq_ignore_ascii_case("all") => Ok(None),
        Some(s) => match s.parse::<i64>() {
            Ok(n) if n >= 1 => Ok(Some(n.min(MAX_LIST_LIMIT))),
            _ => Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("invalid limit: {s} (expected a positive integer or 'all')"),
            )),
        },
    }
}

/// TBE-20: offset always applies now (there is always a limit unless
/// `limit=all`); negatives clamp to 0 (long-standing lenient behavior).
fn parse_list_offset(raw: Option<&str>) -> Result<i64, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(0),
        Some(s) => match s.parse::<i64>() {
            Ok(n) => Ok(n.max(0)),
            Err(_) => Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("invalid offset: {s} (expected an integer >= 0)"),
            )),
        },
    }
}

/// TBE-11: escape LIKE wildcards (`%`, `_`, `\`) and cap at ~200 chars.
/// Callers must add `ESCAPE '\'` to the ILIKE predicate.
pub fn escape_like(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 2);
    for c in raw.chars().take(MAX_SEARCH_CHARS) {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Validated list/export filters, shared so export mirrors list exactly.
struct ParsedFilters {
    statuses: Vec<String>,
    priority: Option<String>,
    ticket_type: Option<String>,
    overdue: bool,
    search_like: Option<String>,
}

fn parse_filters(params: &TicketListParams) -> Result<ParsedFilters, AppError> {
    let statuses = params
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(parse_status_filter)
        .transpose()?
        .unwrap_or_default();
    // TBE-18: priority filter normalized (was case-sensitive exact).
    let priority = params
        .priority
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(validate_priority)
        .transpose()?;
    let ticket_type = params
        .ticket_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| validate_ticket_type(Some(s)))
        .transpose()?;
    let search_like = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", escape_like(s)));
    Ok(ParsedFilters {
        statuses,
        priority,
        ticket_type,
        overdue: parse_overdue_filter(params.overdue.as_deref())?,
        search_like,
    })
}

/// Push the shared WHERE clauses (status/priority/type/overdue/search) plus,
/// for non-staff callers, the requester-or-participant scope (TBE-06).
/// `alias_binds` callers (count queries) pass the same filters — bind order is
/// identical in both builders.
fn push_filter_clauses(
    qb: &mut QueryBuilder<'_, Postgres>,
    f: &ParsedFilters,
    scope_actor: Option<Uuid>,
) {
    let mut any = false;
    let and = |qb: &mut QueryBuilder<'_, Postgres>, any: &mut bool| {
        if *any {
            qb.push(" AND ");
        }
        *any = true;
    };
    if !f.statuses.is_empty() {
        and(&mut *qb, &mut any);
        qb.push("t.status = ANY(").push_bind(f.statuses.clone()).push(")");
    }
    if let Some(priority) = &f.priority {
        and(&mut *qb, &mut any);
        qb.push("t.priority = ").push_bind(priority.clone());
    }
    if let Some(ticket_type) = &f.ticket_type {
        and(&mut *qb, &mut any);
        if ticket_type == "SERVICE_REQUEST" {
            // Match historical 'REQUEST' rows too (migration 0026 folds them,
            // but the IN keeps working regardless).
            qb.push("t.ticket_type IN ('SERVICE_REQUEST', 'REQUEST')");
        } else {
            qb.push("t.ticket_type = ").push_bind(ticket_type.clone());
        }
    }
    if f.overdue {
        and(&mut *qb, &mut any);
        qb.push("t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW() AND t.status IN ('OPEN', 'IN_PROGRESS')");
    }
    if let Some(pat) = &f.search_like {
        and(&mut *qb, &mut any);
        qb.push("(t.title ILIKE ").push_bind(pat.clone()).push(" ESCAPE '\\'");
        qb.push(" OR t.ticket_number ILIKE ").push_bind(pat.clone()).push(" ESCAPE '\\'");
        qb.push(" OR t.description ILIKE ").push_bind(pat.clone()).push(" ESCAPE '\\'");
        qb.push(")");
    }
    // TBE-06: non-staff see only tickets they filed, are assigned to, or
    // have commented on. Staff see everything.
    if let Some(actor) = scope_actor {
        and(&mut *qb, &mut any);
        qb.push("(t.requester_id = ")
            .push_bind(actor)
            .push(" OR t.assignee_id = ")
            .push_bind(actor)
            .push(" OR EXISTS (SELECT 1 FROM ticket_comments c WHERE c.ticket_id = t.id AND c.author_id = ")
            .push_bind(actor)
            .push("))");
    }
    if !any {
        qb.push("1 = 1");
    }
}

/// TBE-06: single-ticket visibility for non-staff (requester, assignee, or
/// prior commenter). Returns 404 — never 403 — so outsiders can't probe for
/// ticket existence. Staff always pass. Shared by get + comments + timeline +
/// attachment download.
pub async fn ensure_ticket_visible(
    pool: &PgPool,
    ticket_id: Uuid,
    actor_id: Uuid,
    role: &str,
) -> Result<(), AppError> {
    if super::auth::is_staff_role(role) {
        return Ok(());
    }
    let visible: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tickets t WHERE t.id = $1 \
         AND (t.requester_id = $2 OR t.assignee_id = $2 \
              OR EXISTS (SELECT 1 FROM ticket_comments c WHERE c.ticket_id = t.id AND c.author_id = $2)))",
    )
    .bind(ticket_id)
    .bind(actor_id)
    .fetch_one(pool)
    .await?;
    if visible {
        Ok(())
    } else {
        Err(AppError::not_found("ticket not found"))
    }
}

/// TBE-26: map FK races (user/asset deleted between the EXISTS check and the
/// write) to 422 instead of 500 — the users.rs constraint-mapping pattern,
/// with the ticket-API status code.
fn map_fk_violation(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &err {
        let is_fk = db.code().as_deref() == Some("23503")
            || db.constraint().is_some_and(|c| c.contains("fkey"));
        if is_fk {
            return AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "referenced user or asset no longer exists",
            );
        }
    }
    AppError::from(err)
}

/// TBE-29: requester must exist and be active.
async fn check_requester(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let row: Option<(String, bool)> =
        sqlx::query_as("SELECT role, active FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    match row {
        None => Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "requester not found")),
        Some((_, false)) => Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "requester is inactive")),
        Some(_) => Ok(()),
    }
}

/// TBE-29: assignee must exist, be active, and be staff (an EMPLOYEE assignee
/// can't action the ticket — no staff mutation rights).
async fn check_assignee(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let row: Option<(String, bool)> =
        sqlx::query_as("SELECT role, active FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    match row {
        None => Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "assignee not found")),
        Some((_, false)) => Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "assignee is inactive")),
        Some((role, true)) if !super::auth::is_staff_role(&role) => Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "assignee must be an agent or admin",
        )),
        Some(_) => Ok(()),
    }
}

/// GET /api/v1/tickets?status=&priority=&type= — validated filters (C2
/// multi-status), default cap 100 (`limit=all` escapes), non-staff scoping.
async fn list_tickets(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    Query(params): Query<TicketListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let filters = parse_filters(&params)?;
    let sort_sql = parse_sort_key(params.sort.as_deref())?;
    let asc = parse_order_asc(params.order.as_deref())?;
    let limit = parse_list_limit(params.limit.as_deref())?;
    let offset = parse_list_offset(params.offset.as_deref())?;
    let scope = if super::auth::is_staff_role(&role) { None } else { Some(actor_id) };

    let mut qb = QueryBuilder::new(TICKET_SELECT);
    let mut cqb = QueryBuilder::new("SELECT COUNT(*) FROM tickets t");
    qb.push(" WHERE ");
    cqb.push(" WHERE ");
    push_filter_clauses(&mut qb, &filters, scope);
    push_filter_clauses(&mut cqb, &filters, scope);

    push_order_by(&mut qb, sort_sql, asc);
    crate::pagination::push_pagination(&mut qb, limit, offset);

    let tickets = qb.build_query_as::<Ticket>().fetch_all(&state.pool).await?;
    let total: i64 = if limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        tickets.len() as i64
    };
    Ok((crate::pagination::total_header(total), Json(tickets)))
}

/// GET /api/v1/tickets/{id} — enriched single ticket row (TBE-06 scoped).
async fn get_ticket(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
) -> Result<Json<Ticket>, AppError> {
    ensure_ticket_visible(&state.pool, ticket_id, actor_id, &role).await?;
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

/// Non-staff callers always file as themselves; staff (ADMIN/AGENT) may file
/// on behalf of another requester (portal/phone intake).
fn resolve_requester_id(role: &str, requested: Option<Uuid>, actor_id: Uuid) -> Uuid {
    if super::auth::is_staff_role(role) {
        requested.unwrap_or(actor_id)
    } else {
        actor_id
    }
}

/// Priority / assignee / status changes are staff-only.
fn require_staff(role: &str) -> Result<(), AppError> {
    if !super::auth::is_staff_role(role) {
        return Err(AppError::new(StatusCode::FORBIDDEN, "agents and admins only"));
    }
    Ok(())
}

/// POST /api/v1/tickets → 201 with auto-generated INC-XXXX tag + audit row.
async fn create_ticket(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<CreateTicketRequest>,
) -> Result<(StatusCode, Json<Ticket>), AppError> {
    // TBE-21: store trimmed; TBE-10: VARCHAR(255) pre-check → 422.
    let title = body.title.trim();
    if title.is_empty() {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "title is required"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("title exceeds {MAX_TITLE_CHARS} characters"),
        ));
    }
    let description = body.description.trim().to_string();
    let priority = match body.priority.as_deref() {
        None => "MEDIUM".to_string(),
        Some(p) => validate_priority(p)?,
    };
    let ticket_type = validate_ticket_type(body.ticket_type.as_deref())?;

    let requester_id = resolve_requester_id(&role, body.requester_id, actor_id);
    check_requester(&state.pool, requester_id).await?;

    // TBE-07: silently ignore assignee_id from non-staff (same forcing
    // pattern as requester_id) — kills the notification/email spam vector.
    let assignee_id = if super::auth::is_staff_role(&role) { body.assignee_id } else { None };
    if let Some(aid) = assignee_id {
        check_assignee(&state.pool, aid).await?;
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

    // Normalized copy: the insert helper binds these verbatim.
    let normalized = CreateTicketRequest {
        title: title.to_string(),
        description,
        ticket_type: Some(ticket_type),
        priority: Some(priority),
        requester_id: Some(requester_id),
        assignee_id,
        asset_id: body.asset_id,
    };

    // Atomic: ticket row + audit row + SLA due-or-nothing.
    let mut tx = state.pool.begin().await?;
    let inserted = insert_ticket_with_number_retry(&mut *tx, &normalized, requester_id, "PORTAL").await?;

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
    .execute(&mut *tx)
    .await?;

    // P1-4: SLA deadline from creation time
    super::sla::set_sla_due(&mut *tx, inserted.id, &inserted.priority, "OPEN", inserted.created_at, false).await?;
    tx.commit().await?;

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
    // TBE-33: staff filing on behalf — the requester gets a "filed for you"
    // notice (previously only the assignee was notified).
    if requester_id != actor_id {
        notify(
            &state.pool,
            requester_id,
            "TICKET_FILED",
            &format!("Ticket filed for you: {}", ticket.ticket_number),
            &format!("{} — {} (filed on your behalf)", ticket.title, ticket.priority),
            "ticket",
            ticket.id,
        )
        .await;
    }

    Ok((StatusCode::CREATED, Json(ticket)))
}

/// PATCH /api/v1/tickets/{id}/status — whitelisted transitions only.
/// TBE-09: fully atomic (status + SLA + audit in one tx); TBE-25: the current
/// row is locked FOR UPDATE so concurrent PATCHes serialize instead of both
/// passing the whitelist from the same old status.
async fn update_ticket_status(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    Json(body): Json<UpdateTicketStatusRequest>,
) -> Result<Json<Ticket>, AppError> {
    require_staff(&role)?;
    // TBE-24: garbage status values get their own error, distinct from an
    // illegal jump between two valid statuses.
    let new_status = validate_status_value(&body.status)?;

    let mut tx = state.pool.begin().await?;
    let current: Option<(String, String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT status, priority, created_at FROM tickets WHERE id = $1 FOR UPDATE")
            .bind(ticket_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((old_status, old_priority, old_created_at)) = current else {
        return Err(AppError::not_found("ticket not found"));
    };

    // TBE-24: same-status PATCH is a no-op report, not an "illegal transition".
    if new_status == old_status {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("ticket is already {old_status}"),
        ));
    }
    if !allowed_transitions(&old_status).contains(&new_status.as_str()) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("illegal status transition: {old_status} -> {new_status}"),
        ));
    }
    // TBE-05: the only whitelisted exit from CLOSED is the OPEN reopen, so a
    // status PATCH that reaches here from CLOSED is by definition the legit
    // reopen — field/comment/attachment mutations are what the guard blocks.

    sqlx::query("UPDATE tickets SET status = $2, updated_at = NOW() WHERE id = $1")
        .bind(ticket_id)
        .bind(&new_status)
        .execute(&mut *tx)
        .await
        .map_err(map_fk_violation)?;

    // P1-4: SLA clock runs while OPEN/IN_PROGRESS, stops when closed.
    // TBE-03: reopens restart the clock from NOW (not created_at) and clear a
    // stale escalation flag so a re-breach can notify again.
    let reopened = matches!(old_status.as_str(), "CLOSED" | "RESOLVED")
        && matches!(new_status.as_str(), "OPEN" | "IN_PROGRESS");
    super::sla::set_sla_due(&mut *tx, ticket_id, &old_priority, &new_status, old_created_at, reopened).await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TICKET_STATUS', 'ticket', $2, $3)",
    )
    .bind(actor_id)
    .bind(ticket_id)
    .bind(json!({ "from": old_status, "to": new_status }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let updated: Ticket =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    // P1-2: status change → notify requester + assignee
    let requester = updated.requester_id;
    notify(
        &state.pool,
        requester,
        "TICKET_STATUS",
        &format!("{} → {}", updated.ticket_number, new_status.replace('_', " ")),
        &format!(
            "Status of {} changed from {} to {}",
            updated.title,
            old_status.replace('_', " "),
            new_status.replace('_', " ")
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
                &format!("{} → {}", updated.ticket_number, new_status.replace('_', " ")),
                &format!(
                    "Status of {} changed from {} to {}",
                    updated.title,
                    old_status.replace('_', " "),
                    new_status.replace('_', " ")
                ),
                "ticket",
                ticket_id,
            )
            .await;
        }
    }

    Ok(Json(updated))
}

/// PATCH /api/v1/tickets/{id} — update title/description/type/priority /
/// assignee / asset (C1 adds the first three). Staff-only, atomic (TBE-09),
/// row-locked (TBE-25), CLOSED-guarded (TBE-05), no-op aware (TBE-23).
async fn update_ticket(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    Json(body): Json<UpdateTicketRequest>,
) -> Result<Json<Ticket>, AppError> {
    require_staff(&role)?;

    // Validate provided scalar fields first (same rules as create).
    let new_title = match body.title.as_deref() {
        None => None,
        Some(t) => {
            let trimmed = t.trim();
            if trimmed.is_empty() {
                return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "title is required"));
            }
            if trimmed.chars().count() > MAX_TITLE_CHARS {
                return Err(AppError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("title exceeds {MAX_TITLE_CHARS} characters"),
                ));
            }
            Some(trimmed.to_string())
        }
    };
    let new_description = body.description.as_deref().map(|d| d.trim().to_string());
    // R2-BE-11 (#144): blank ticket_type is 422 on update (like title);
    // absent stays unchanged.
    let new_ticket_type = validate_ticket_type_update(body.ticket_type.as_deref())?;
    let new_priority_opt = body.priority.as_deref().map(validate_priority).transpose()?;

    let mut tx = state.pool.begin().await?;
    let current: Option<(
        String,
        String,
        String,
        String,
        String,
        Option<Uuid>,
        Option<Uuid>,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        "SELECT status, priority, title, description, ticket_type, assignee_id, asset_id, created_at \
         FROM tickets WHERE id = $1 FOR UPDATE",
    )
    .bind(ticket_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((old_status, old_priority, old_title, old_description, old_type, old_assignee, old_asset, old_created_at)) =
        current
    else {
        return Err(AppError::not_found("ticket not found"));
    };

    // TBE-05: CLOSED tickets are immutable (RESOLVED stays mutable); the only
    // way out of CLOSED is the status-PATCH reopen.
    if old_status == "CLOSED" {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ticket is closed — reopen it before editing",
        ));
    }

    let new_priority = new_priority_opt.unwrap_or_else(|| old_priority.clone());
    let new_title = new_title.unwrap_or_else(|| old_title.clone());
    let new_description = new_description.unwrap_or_else(|| old_description.clone());
    let new_ticket_type = new_ticket_type.unwrap_or_else(|| old_type.clone());

    let new_assignee = match body.assignee_id {
        Some(v) => v,
        None => old_assignee,
    };
    if let Some(aid) = new_assignee {
        if Some(aid) != old_assignee {
            check_assignee(&state.pool, aid).await?;
        }
    }

    let new_asset = match body.asset_id {
        Some(v) => v,
        None => old_asset,
    };
    if let Some(asid) = new_asset {
        if Some(asid) != old_asset {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)")
                .bind(asid)
                .fetch_one(&state.pool)
                .await?;
            if !exists {
                return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "asset not found"));
            }
        }
    }

    // TBE-23: a PATCH that changes nothing must not bump updated_at or write
    // audit rows — return the current row untouched.
    let priority_changed = new_priority != old_priority;
    let title_changed = new_title != old_title;
    let description_changed = new_description != old_description;
    let type_changed = new_ticket_type != old_type;
    let assignee_changed = new_assignee != old_assignee;
    let asset_changed = new_asset != old_asset;
    if !(priority_changed || title_changed || description_changed || type_changed || assignee_changed || asset_changed) {
        tx.rollback().await?;
        let current_ticket: Ticket =
            sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
                .bind(ticket_id)
                .fetch_one(&state.pool)
                .await?;
        return Ok(Json(current_ticket));
    }

    sqlx::query(
        "UPDATE tickets SET title = $2, description = $3, ticket_type = $4, priority = $5, \
         assignee_id = $6, asset_id = $7, updated_at = NOW() WHERE id = $1",
    )
    .bind(ticket_id)
    .bind(&new_title)
    .bind(&new_description)
    .bind(&new_ticket_type)
    .bind(&new_priority)
    .bind(new_assignee)
    .bind(new_asset)
    .execute(&mut *tx)
    .await
    .map_err(map_fk_violation)?;

    if priority_changed {
        super::sla::set_sla_due(&mut *tx, ticket_id, &new_priority, &old_status, old_created_at, false).await?;
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_PRIORITY', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(json!({ "from": old_priority, "to": new_priority }))
        .execute(&mut *tx)
        .await?;
    }
    // C1: title/description/type edits get a ticket-side audit row (descriptions
    // stored as truncated previews — full bodies would bloat the audit table).
    if title_changed || description_changed || type_changed {
        let mut diff = serde_json::Map::new();
        if title_changed {
            diff.insert("title".into(), json!({ "from": old_title, "to": new_title }));
        }
        if type_changed {
            diff.insert("ticket_type".into(), json!({ "from": old_type, "to": new_ticket_type }));
        }
        if description_changed {
            let preview = |s: &str| s.chars().take(200).collect::<String>();
            diff.insert(
                "description".into(),
                json!({ "from": preview(&old_description), "to": preview(&new_description) }),
            );
        }
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_EDIT', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(serde_json::Value::Object(diff))
        .execute(&mut *tx)
        .await?;
    }
    if assignee_changed {
        // TBE-08: the diff carries old AND new assignee (was: new only).
        let new_name: Option<String> = match new_assignee {
            Some(aid) => sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
                .bind(aid)
                .fetch_optional(&mut *tx)
                .await?,
            None => None,
        };
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_ASSIGN', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(json!({ "from": old_assignee, "to": new_assignee, "assignee_id": new_assignee, "assignee_name": new_name }))
        .execute(&mut *tx)
        .await?;
    }
    if asset_changed {
        // TBE-08: asset (re)assignment previously wrote no audit row at all.
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'TICKET_ASSET', 'ticket', $2, $3)",
        )
        .bind(actor_id)
        .bind(ticket_id)
        .bind(json!({ "from": old_asset, "to": new_asset }))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let updated: Ticket =
        sqlx::query_as::<_, Ticket>(&format!("{TICKET_SELECT} WHERE t.id = $1"))
            .bind(ticket_id)
            .fetch_one(&state.pool)
            .await?;

    if assignee_changed {
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
///
/// TBE-35: the missing OPEN→RESOLVED and IN_PROGRESS→CLOSED direct jumps are
/// deliberate product behavior (two-step resolution: work must pass through
/// IN_PROGRESS, and closure of resolved work is an explicit second step), not
/// an omission — keep this whitelist as-is.
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
pub async fn allocate_next_ticket_number(conn: &mut sqlx::PgConnection) -> Result<String, AppError> {
    let next_num: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX((substring(ticket_number FROM '([0-9]+)$'))::bigint), COUNT(*)) + 1 FROM tickets",
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(format!("INC-{:04}", next_num))
}

async fn insert_ticket_with_number_retry(
    conn: &mut sqlx::PgConnection,
    body: &CreateTicketRequest,
    requester_id: Uuid,
    source: &str,
) -> Result<Ticket, AppError> {
    let ticket_type = normalize_ticket_type(body.ticket_type.as_deref());
    let priority = body.priority.clone().unwrap_or_else(|| "MEDIUM".to_string());
    // TBE-21 defense-in-depth: store trimmed even if a caller forgets.
    let title = body.title.trim();
    let description = body.description.trim();

    // NOTE: runs inside the caller's transaction, so number races use
    // ON CONFLICT DO NOTHING + retry (a unique-violation *error* would poison
    // the whole tx — Postgres aborts all later statements after any error).
    for attempt in 0..10 {
        let base = allocate_next_ticket_number(&mut *conn).await?;
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

        let row: Option<Ticket> = sqlx::query_as::<_, Ticket>(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, \
                source, requester_id, assignee_id, asset_id) \
             VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $9) \
             ON CONFLICT (ticket_number) DO NOTHING \
             RETURNING id, ticket_number, title, description, ticket_type, priority, status, source, \
                requester_id, assignee_id, asset_id, created_at, updated_at, \
                NULL::timestamptz AS sla_due_at, NULL::timestamptz AS sla_escalated_at, \
                NULL::text AS requester_name, NULL::text AS assignee_name, \
                NULL::text AS asset_tag, NULL::text AS asset_name",
        )
        .bind(&ticket_number)
        .bind(title)
        .bind(description)
        .bind(&ticket_type)
        .bind(&priority)
        .bind(source)
        .bind(requester_id)
        .bind(body.assignee_id)
        .bind(body.asset_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(map_fk_violation)?;

        match row {
            Some(ticket) => return Ok(ticket),
            None => {
                tracing::warn!("ticket number {ticket_number} collided, retrying");
                continue;
            }
        }
    }

    Err(AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate a unique ticket number",
    ))
}

/// TBE-34: a csv::Error from an in-memory writer signals a bug, not bad
/// client input — 500, not 400.
fn csv_err(e: csv::Error) -> AppError {
    AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("csv error: {e}"))
}

/// GET /api/v1/tickets/export?status=&priority=&type= — CSV download of the
/// filtered ticket list (mirrors list_tickets filters; capped at 10k rows).
/// TBE-06: staff-only — the old open export dumped up to 10k rows of other
/// people's tickets to any authenticated user.
async fn export_tickets(
    State(state): State<AppState>,
    Extension(_actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    Query(params): Query<TicketListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    require_staff(&role)?;
    let filters = parse_filters(&params)?;
    let sort_sql = parse_sort_key(params.sort.as_deref())?;
    let asc = parse_order_asc(params.order.as_deref())?;

    let mut qb = QueryBuilder::new(TICKET_SELECT);
    qb.push(" WHERE ");
    push_filter_clauses(&mut qb, &filters, None);
    push_order_by(&mut qb, sort_sql, asc);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_gate_denies_non_staff() {
        assert!(require_staff("ADMIN").is_ok());
        assert!(require_staff("AGENT").is_ok());
        assert!(require_staff("EMPLOYEE").is_err());
        assert!(require_staff("").is_err());
        assert!(require_staff("SUPERADMIN").is_err());
    }

    #[test]
    fn non_staff_requester_forced_to_actor() {
        let actor = Uuid::new_v4();
        let other = Uuid::new_v4();
        // Non-staff always file as themselves, even when spoofing requester_id.
        assert_eq!(resolve_requester_id("EMPLOYEE", Some(other), actor), actor);
        assert_eq!(resolve_requester_id("EMPLOYEE", None, actor), actor);
        assert_eq!(resolve_requester_id("BOGUS", Some(other), actor), actor);
        // Staff may file on behalf of someone else.
        assert_eq!(resolve_requester_id("AGENT", Some(other), actor), other);
        assert_eq!(resolve_requester_id("ADMIN", Some(other), actor), other);
        assert_eq!(resolve_requester_id("ADMIN", None, actor), actor);
    }

    #[test]
    fn priority_allowlist_normalizes_and_rejects_garbage() {
        assert_eq!(validate_priority("HIGH").unwrap(), "HIGH");
        assert_eq!(validate_priority("  high ").unwrap(), "HIGH");
        assert_eq!(validate_priority("MEDIUM ").unwrap(), "MEDIUM");
        for bad in ["CRITICAL", "", "high!", "none"] {
            let err = validate_priority(bad).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
        }
    }

    #[test]
    fn ticket_type_allowlist_defaults_and_maps_legacy() {
        assert_eq!(validate_ticket_type(None).unwrap(), "INCIDENT");
        assert_eq!(validate_ticket_type(Some("incident")).unwrap(), "INCIDENT");
        assert_eq!(validate_ticket_type(Some("REQUEST")).unwrap(), "SERVICE_REQUEST");
        assert_eq!(validate_ticket_type(Some("change")).unwrap(), "CHANGE");
        assert_eq!(validate_ticket_type(Some("problem")).unwrap(), "PROBLEM");
        for bad in ["whatever", "INC", ""] {
            // "" normalizes to INCIDENT (legacy default), so only truly unknown fail.
            if bad.is_empty() {
                assert_eq!(validate_ticket_type(Some(bad)).unwrap(), "INCIDENT");
            } else {
                let err = validate_ticket_type(Some(bad)).unwrap_err();
                assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
            }
        }
    }

    #[test]
    fn update_rejects_blank_ticket_type_but_ignores_absent() {
        // R2-BE-11 (#144): None stays unchanged; blank is 422 (never a
        // silent reset to INCIDENT); valid values still normalize.
        assert_eq!(validate_ticket_type_update(None).unwrap(), None);
        for bad in ["", "   ", "\t"] {
            let err = validate_ticket_type_update(Some(bad)).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
        }
        assert_eq!(
            validate_ticket_type_update(Some("change")).unwrap(),
            Some("CHANGE".to_string())
        );
        assert_eq!(
            validate_ticket_type_update(Some("REQUEST")).unwrap(),
            Some("SERVICE_REQUEST".to_string())
        );
        let err = validate_ticket_type_update(Some("bogus")).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn multi_status_filter_validates_each_entry() {
        assert_eq!(
            parse_status_filter("OPEN,IN_PROGRESS").unwrap(),
            vec!["OPEN".to_string(), "IN_PROGRESS".to_string()]
        );
        assert_eq!(
            parse_status_filter(" open , resolved ").unwrap(),
            vec!["OPEN".to_string(), "RESOLVED".to_string()]
        );
        for bad in ["OPEN,BOGUS", "bogus", "OPEN,,CLOSED,"] {
            if bad == "OPEN,,CLOSED," {
                // empty segments are skipped, not errors
                assert_eq!(
                    parse_status_filter(bad).unwrap(),
                    vec!["OPEN".to_string(), "CLOSED".to_string()]
                );
            } else {
                let err = parse_status_filter(bad).unwrap_err();
                assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
            }
        }
    }

    #[test]
    fn list_limit_defaults_caps_and_escapes() {
        assert_eq!(parse_list_limit(None).unwrap(), Some(100));
        assert_eq!(parse_list_limit(Some("")).unwrap(), Some(100));
        assert_eq!(parse_list_limit(Some("all")).unwrap(), None);
        assert_eq!(parse_list_limit(Some(" ALL ")).unwrap(), None);
        assert_eq!(parse_list_limit(Some("25")).unwrap(), Some(25));
        assert_eq!(parse_list_limit(Some("9999")).unwrap(), Some(500));
        for bad in ["0", "-5", "abc", "10x"] {
            let err = parse_list_limit(Some(bad)).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
        }
        assert_eq!(parse_list_offset(None).unwrap(), 0);
        assert_eq!(parse_list_offset(Some("40")).unwrap(), 40);
        assert_eq!(parse_list_offset(Some("-3")).unwrap(), 0);
        assert!(parse_list_offset(Some("abc")).is_err());
    }

    #[test]
    fn be14_overdue_accepts_bool_forms_and_rejects_garbage() {
        // R2-BE-14 (#161): ?overdue=maybe is 422, not axum 400.
        // The struct itself accepts arbitrary strings (Query won't 400 first).
        let p: TicketListParams = serde_json::from_value(serde_json::json!({"overdue": "maybe"})).unwrap();
        assert_eq!(p.overdue.as_deref(), Some("maybe"));
        assert!(!parse_overdue_filter(None).unwrap());
        assert!(!parse_overdue_filter(Some("")).unwrap());
        assert!(!parse_overdue_filter(Some("   ")).unwrap());
        for yes in ["true", "TRUE", " True ", "1"] {
            assert!(parse_overdue_filter(Some(yes)).unwrap(), "for {yes:?}");
        }
        for no in ["false", "FALSE", " False ", "0"] {
            assert!(!parse_overdue_filter(Some(no)).unwrap(), "for {no:?}");
        }
        for bad in ["maybe", "yes", "2", "truee", "on"] {
            let err = parse_overdue_filter(Some(bad)).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
        }
    }

    #[test]
    fn sort_and_order_reject_garbage() {
        assert_eq!(parse_sort_key(None).unwrap(), "t.created_at");
        assert_eq!(parse_sort_key(Some("priority")).unwrap(), ticket_sort("priority"));
        assert_eq!(parse_sort_key(Some(" Priority ")).unwrap(), ticket_sort("priority"));
        let err = parse_sort_key(Some("sla")).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(!parse_order_asc(None).unwrap());
        assert!(parse_order_asc(Some("asc")).unwrap());
        assert!(parse_order_asc(Some("ASC")).unwrap());
        assert!(!parse_order_asc(Some("desc")).unwrap());
        let err = parse_order_asc(Some("sideways")).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn ux12_sla_due_at_sort_key_accepted() {
        // UX-12 (#186): the Tickets.tsx sibling writes ?sort=sla_due_at — the
        // key must resolve (case-insensitively, like every other key) and show
        // up in the 422 allowlist message; near-misses still 422.
        assert_eq!(parse_sort_key(Some("sla_due_at")).unwrap(), "t.sla_due_at");
        assert_eq!(parse_sort_key(Some("SLA_DUE_AT")).unwrap(), "t.sla_due_at");
        assert_eq!(parse_sort_key(Some(" Sla_Due_At ")).unwrap(), "t.sla_due_at");
        assert_eq!(ticket_sort("sla_due_at"), "t.sla_due_at");
        for bad in ["sla", "sla_due", "due_at", "sla-due-at"] {
            let err = parse_sort_key(Some(bad)).unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
            assert!(
                err.message.contains("sla_due_at"),
                "allowlist message names the key: {}",
                err.message
            );
        }
    }

    #[test]
    fn ux12_sla_due_at_orders_nulls_last_both_directions() {
        // The generated ORDER BY carries NULLS LAST for sla_due_at in both
        // directions, and bare ASC/DESC for every non-nullable key.
        fn order_by_for(key: &str, asc: bool) -> String {
            let sort_sql = parse_sort_key(Some(key)).unwrap();
            let mut qb = QueryBuilder::<Postgres>::new("SELECT 1");
            push_order_by(&mut qb, sort_sql, asc);
            qb.sql().to_string()
        }
        assert_eq!(
            order_by_for("sla_due_at", true),
            "SELECT 1 ORDER BY t.sla_due_at ASC NULLS LAST, t.created_at DESC"
        );
        assert_eq!(
            order_by_for("sla_due_at", false),
            "SELECT 1 ORDER BY t.sla_due_at DESC NULLS LAST, t.created_at DESC"
        );
        for key in ["created_at", "priority", "title", "status", "ticket_number", "ticket_type", "updated_at"] {
            for asc in [true, false] {
                let sql = order_by_for(key, asc);
                assert!(!sql.contains("NULLS"), "no NULLS for {key} (asc={asc}): {sql}");
                assert!(sql.ends_with(", t.created_at DESC"), "stable tiebreak kept: {sql}");
            }
        }
    }

    #[test]
    fn like_escapes_wildcards_and_caps_length() {
        assert_eq!(escape_like("printer"), "printer");
        assert_eq!(escape_like("100%_x\\y"), "100\\%\\_x\\\\y");
        assert_eq!(escape_like("%"), "\\%");
        let long = "a".repeat(500);
        assert_eq!(escape_like(&long).len(), 200);
    }

    #[test]
    fn two_step_resolution_stays_rejected() {
        // TBE-35: direct OPEN→RESOLVED / IN_PROGRESS→CLOSED jumps stay illegal.
        assert!(!allowed_transitions("OPEN").contains(&"RESOLVED"));
        assert!(!allowed_transitions("IN_PROGRESS").contains(&"CLOSED"));
        assert!(allowed_transitions("CLOSED").contains(&"OPEN"));
    }
}

/// R2 P2 regression tests (issue #144 R2-BE-11): DB-backed PATCH handler
/// tests. Same TEST_DATABASE_URL-with-skip pattern as
/// routes::intake::r2_regression_tests.
#[cfg(test)]
mod r2_p2_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test_pw@127.0.0.1:55434/itms_test";

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DB_URL.to_string());
        match PgPoolOptions::new().max_connections(5).connect(&url).await {
            Ok(pool) => {
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("test DB migrations must apply");
                Some(pool)
            }
            Err(e) => {
                eprintln!("r2_p2_regression_tests: skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn staff_actor(pool: &sqlx::PgPool) -> Uuid {
        let email = format!("r2-p2-staff-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash) \
             VALUES ('R2 Staff', $1, 'ADMIN', 'IT', 'test-hash') RETURNING id",
        )
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn make_ticket(pool: &sqlx::PgPool, requester: Uuid, ticket_type: &str) -> Uuid {
        let number = format!("INC-7{:09}", rand::random::<u32>() % 1_000_000_000);
        sqlx::query_scalar(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, requester_id) \
             VALUES ($1, 't', 'd', $2, $3) RETURNING id",
        )
        .bind(&number)
        .bind(ticket_type)
        .bind(requester)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn patch_body(ticket_type: Option<&str>) -> UpdateTicketRequest {
        UpdateTicketRequest {
            title: None,
            description: None,
            ticket_type: ticket_type.map(|s| s.to_string()),
            priority: None,
            assignee_id: None,
            asset_id: None,
        }
    }

    async fn stored_type(pool: &sqlx::PgPool, id: Uuid) -> String {
        sqlx::query_scalar("SELECT ticket_type FROM tickets WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn patch_blank_ticket_type_rejected_on_change_ticket() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        for raw in ["", "   "] {
            let tid = make_ticket(&pool, actor, "CHANGE").await;
            let err = update_ticket(
                State(test_state(pool.clone())),
                Extension(actor),
                Extension("ADMIN".to_string()),
                UuidPath(tid),
                Json(patch_body(Some(raw))),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {raw:?}");
            assert!(err.message.contains("ticket_type"), "message: {}", err.message);
            // The CHANGE type survives — no silent reset to INCIDENT.
            assert_eq!("CHANGE", stored_type(&pool, tid).await);
        }
    }

    #[tokio::test]
    async fn patch_without_ticket_type_leaves_type_unchanged() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        let tid = make_ticket(&pool, actor, "CHANGE").await;
        let body = UpdateTicketRequest {
            title: Some("renamed title".to_string()),
            description: None,
            ticket_type: None,
            priority: None,
            assignee_id: None,
            asset_id: None,
        };
        let out = update_ticket(
            State(test_state(pool.clone())),
            Extension(actor),
            Extension("ADMIN".to_string()),
            UuidPath(tid),
            Json(body),
        )
        .await
        .unwrap();
        assert_eq!("CHANGE", out.0.ticket_type);
        assert_eq!("renamed title", out.0.title);
        assert_eq!("CHANGE", stored_type(&pool, tid).await);
    }

    #[tokio::test]
    async fn patch_valid_ticket_type_still_applies() {
        // Guard against over-rejection: real type changes keep working.
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        let tid = make_ticket(&pool, actor, "CHANGE").await;
        let out = update_ticket(
            State(test_state(pool.clone())),
            Extension(actor),
            Extension("ADMIN".to_string()),
            UuidPath(tid),
            Json(patch_body(Some("problem"))),
        )
        .await
        .unwrap();
        assert_eq!("PROBLEM", out.0.ticket_type);
        assert_eq!("PROBLEM", stored_type(&pool, tid).await);
    }
}

/// R2 P3 regression tests (issue #161 R2-BE-14): `?overdue=` garbage is 422
/// at the handler, valid bool forms pass. Same TEST_DATABASE_URL-with-skip
/// pattern as routes::intake::r2_regression_tests.
#[cfg(test)]
mod r2_p3_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test_pw@127.0.0.1:55434/itms_test";

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DB_URL.to_string());
        match PgPoolOptions::new().max_connections(5).connect(&url).await {
            Ok(pool) => {
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("test DB migrations must apply");
                Some(pool)
            }
            Err(e) => {
                eprintln!("r2_p3_regression_tests(tickets): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn staff_actor(pool: &sqlx::PgPool) -> Uuid {
        let email = format!("r2-p3-staff-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash) \
             VALUES ('R2P3 Staff', $1, 'ADMIN', 'IT', 'test-hash') RETURNING id",
        )
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn list_params(overdue: Option<&str>) -> TicketListParams {
        TicketListParams {
            status: None,
            priority: None,
            overdue: overdue.map(|s| s.to_string()),
            ticket_type: None,
            limit: None,
            offset: None,
            sort: None,
            order: None,
            search: None,
        }
    }

    #[tokio::test]
    async fn overdue_garbage_returns_422() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        for bad in ["maybe", "yes", "2", "on"] {
            let res = list_tickets(
                State(test_state(pool.clone())),
                Extension(actor),
                Extension("ADMIN".to_string()),
                Query(list_params(Some(bad))),
            )
            .await;
            let err = match res {
                Ok(_) => panic!("overdue={bad:?} should be 422"),
                Err(e) => e,
            };
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "for {bad:?}");
            assert!(err.message.contains("overdue"), "message: {}", err.message);
        }
    }

    #[tokio::test]
    async fn overdue_bool_forms_accepted() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        // None + blank + all four bool forms reach the DB (Ok), not 422.
        for raw in [None, Some(""), Some("true"), Some("FALSE"), Some("1"), Some("0")] {
            let res = list_tickets(
                State(test_state(pool.clone())),
                Extension(actor),
                Extension("ADMIN".to_string()),
                Query(list_params(raw)),
            )
            .await;
            match res {
                Ok(_) => {}
                Err(e) => panic!("overdue={raw:?} should pass, got {} {}", e.status, e.message),
            }
        }
        // parse_filters agrees with the handler path.
        assert!(parse_filters(&list_params(Some("true"))).unwrap().overdue);
        assert!(!parse_filters(&list_params(Some("0"))).unwrap().overdue);
        assert!(!parse_filters(&list_params(None)).unwrap().overdue);
    }
}

/// UX-12 (#186) regression tests: `?sort=sla_due_at` orders by the SLA
/// deadline with NULLS LAST in both directions at the handler level. Same
/// TEST_DATABASE_URL-with-skip pattern as routes::intake::r2_regression_tests.
#[cfg(test)]
mod ux12_regression_tests {
    use super::*;
    use axum::response::IntoResponse;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test_pw@127.0.0.1:55434/itms_test";

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DB_URL.to_string());
        match PgPoolOptions::new().max_connections(5).connect(&url).await {
            Ok(pool) => {
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("test DB migrations must apply");
                Some(pool)
            }
            Err(e) => {
                eprintln!("ux12_regression_tests(tickets): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn staff_actor(pool: &sqlx::PgPool) -> Uuid {
        let email = format!("ux12-staff-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash) \
             VALUES ('UX12 Staff', $1, 'ADMIN', 'IT', 'test-hash') RETURNING id",
        )
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Insert one ticket with an explicit sla_due_at (None = undated);
    /// returns its ticket_number for order assertions.
    async fn make_ticket(
        pool: &sqlx::PgPool,
        requester: Uuid,
        sla_due_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> String {
        let number = format!("INC-8{:09}", rand::random::<u32>() % 1_000_000_000);
        sqlx::query_scalar(
            "INSERT INTO tickets (ticket_number, title, description, requester_id, sla_due_at) \
             VALUES ($1, 'ux12 sort probe', 'd', $2, $3) RETURNING ticket_number",
        )
        .bind(&number)
        .bind(requester)
        .bind(sla_due_at)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Call the list handler and read the JSON body back into tickets (the
    /// handler returns `impl IntoResponse`, so round-trip through the
    /// response like a real client would).
    async fn list_sorted(pool: &sqlx::PgPool, actor: Uuid, sort: &str, order: &str) -> Vec<Ticket> {
        let params = TicketListParams {
            status: None,
            priority: None,
            overdue: None,
            ticket_type: None,
            limit: Some("all".to_string()),
            offset: None,
            sort: Some(sort.to_string()),
            order: Some(order.to_string()),
            search: None,
        };
        let res = list_tickets(
            State(test_state(pool.clone())),
            Extension(actor),
            Extension("ADMIN".to_string()),
            Query(params),
        )
        .await;
        let resp = match res {
            Ok(ok) => ok.into_response(),
            Err(e) => panic!("sort={sort} order={order} should pass, got {} {}", e.status, e.message),
        };
        let bytes = axum::body::to_bytes(resp.into_body(), 16 * 1024 * 1024).await.unwrap();
        serde_json::from_slice::<Vec<Ticket>>(&bytes).unwrap()
    }

    #[tokio::test]
    async fn sla_due_at_sorts_nulls_last_asc_and_desc() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        let now = chrono::Utc::now();
        let early = make_ticket(&pool, actor, Some(now - chrono::Duration::days(30))).await;
        let late = make_ticket(&pool, actor, Some(now + chrono::Duration::days(365))).await;
        let undated = make_ticket(&pool, actor, None).await;
        // Relative order of OUR rows only — other tests' rows may interleave.
        let ours = |rows: Vec<Ticket>| {
            rows.into_iter()
                .map(|t| t.ticket_number)
                .filter(|n| *n == early || *n == late || *n == undated)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ours(list_sorted(&pool, actor, "sla_due_at", "asc").await),
            vec![early.clone(), late.clone(), undated.clone()],
            "asc: earliest first, undated last"
        );
        assert_eq!(
            ours(list_sorted(&pool, actor, "sla_due_at", "desc").await),
            vec![late, early, undated],
            "desc: latest first, undated STILL last (not PG's NULLS FIRST default)"
        );
    }

    #[tokio::test]
    async fn unknown_sort_key_still_422() {
        let Some(pool) = test_pool().await else { return };
        let actor = staff_actor(&pool).await;
        let params = TicketListParams {
            status: None,
            priority: None,
            overdue: None,
            ticket_type: None,
            limit: None,
            offset: None,
            sort: Some("sla".to_string()),
            order: None,
            search: None,
        };
        let err = match list_tickets(
            State(test_state(pool.clone())),
            Extension(actor),
            Extension("ADMIN".to_string()),
            Query(params),
        )
        .await
        {
            Ok(_) => panic!("sort=sla should be 422"),
            Err(e) => e,
        };
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("invalid sort"), "message: {}", err.message);
        assert!(err.message.contains("sla_due_at"), "message: {}", err.message);
    }
}
