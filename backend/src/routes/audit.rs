use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::AppState;
use crate::models::AuditLogEntry;

use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new().route("/log", get(audit_log))
}

#[derive(Debug, Deserialize)]
pub struct AuditLogParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

/// Whitelisted ORDER BY columns (never interpolate user input directly).
/// `actor_name` maps to the joined users table; unknown columns fall back to
/// the default so a bad `sort` value can never 500 or inject SQL.
fn audit_sort(col: &str) -> &'static str {
    match col {
        "created_at" => "al.created_at",
        "actor_name" => "u.name",
        "action" => "al.action",
        "target_type" => "al.target_type",
        "target_id" => "al.target_id",
        _ => "al.created_at",
    }
}

/// GET /api/v1/audit/log?limit=20&offset=40 — most recent audit entries, newest
/// first. Returns X-Total-Count so the client can render pagination.
async fn audit_log(
    State(state): State<AppState>,
    Query(params): Query<AuditLogParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    // Always paginated (default 20) — audit logs grow without bound.
    let (limit, offset) = crate::pagination::page_params(params.limit, params.offset);
    let limit = limit.unwrap_or(20);

    // No filter branches, so a plain COUNT mirrors the data query exactly.
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs")
        .fetch_one(&state.pool)
        .await?;

    // Only whitelisted fragments are interpolated (audit_sort / validated
    // direction) — user input can never reach the SQL string directly.
    let order_sql = if params.order.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    let sort_sql = audit_sort(params.sort.as_deref().unwrap_or("created_at"));
    let sql = format!(
        "SELECT al.id, al.actor_id, al.action, al.target_type, al.target_id, al.diff, \
                al.created_at, u.name AS actor_name \
         FROM audit_logs al \
         LEFT JOIN users u ON u.id = al.actor_id \
         ORDER BY {sort_sql} {order_sql} \
         LIMIT $1 OFFSET $2"
    );

    let entries = sqlx::query_as::<_, AuditLogEntry>(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

    Ok((crate::pagination::total_header(total), Json(entries)))
}
