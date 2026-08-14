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
}

/// GET /api/v1/audit/log?limit=20 — most recent audit entries, newest first.
async fn audit_log(
    State(state): State<AppState>,
    Query(params): Query<AuditLogParams>,
) -> Result<Json<Vec<AuditLogEntry>>, AppError> {
    let limit = params.limit.unwrap_or(20).clamp(1, 200);

    let entries = sqlx::query_as::<_, AuditLogEntry>(
        "SELECT al.id, al.actor_id, al.action, al.target_type, al.target_id, al.diff, \
                al.created_at, u.name AS actor_name \
         FROM audit_logs al \
         LEFT JOIN users u ON u.id = al.actor_id \
         ORDER BY al.created_at DESC \
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(entries))
}
