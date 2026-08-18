// In-app notification center + outbound email queue (P1-2, issue #43).
// notify() is the single hook used by tickets/requests handlers; it writes a
// notification row and (for real addresses, never @itms.local) a pending_emails
// row drained by the external itms-mailer cron (SMTP-gated).

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{db::AppState, models::Notification};
use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_notifications))
        .route("/unread-count", get(unread_count))
        .route("/{id}/read", get(mark_read))
        .route("/read-all", get(mark_all_read))
}

/// Shared hook: in-app notification (+ outbound email queue for real addrs).
/// Best-effort — failures are logged, never fail the caller.
pub async fn notify(
    pool: &PgPool,
    user_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
    ref_type: &str,
    ref_id: Uuid,
) {
    let res = sqlx::query(
        "INSERT INTO notifications (user_id, kind, title, body, ref_type, ref_id) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(ref_type)
    .bind(ref_id)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::error!("notify: insert failed: {e}");
    }

    // outbound email — only for real addresses (skip @itms.local seed users)
    let email: Option<(String, Option<String>)> = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT email, name FROM users WHERE id = $1 AND email NOT LIKE '%@itms.local'",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if let Some((to, name)) = email {
        let subject = format!("[ITMS] {title}");
        let body = format!(
            "{body}\n\n—\nITMS {ref_type} {ref_id}\nhttps://itms.ai-automation-hub.tech"
        );
        let res = sqlx::query(
            "INSERT INTO pending_emails (to_email, to_name, subject, body, kind, ref_type, ref_id) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&to)
        .bind(name)
        .bind(&subject)
        .bind(&body)
        .bind(kind)
        .bind(ref_type)
        .bind(ref_id)
        .execute(pool)
        .await;
        if let Err(e) = res {
            tracing::error!("notify: email queue insert failed: {e}");
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct NotificationQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub unread: Option<bool>,
}

async fn list_notifications(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Query(q): Query<NotificationQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut where_sql = String::from(" WHERE n.user_id = $1");
    if q.unread == Some(true) {
        where_sql.push_str(" AND n.read_at IS NULL");
    }
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM notifications n{where_sql}"))
        .bind(actor_id)
        .fetch_one(&state.pool)
        .await?;

    let mut sql = String::from(
        "SELECT n.id, n.user_id, n.kind, n.title, n.body, n.ref_type, n.ref_id, n.read_at, n.created_at \
         FROM notifications n",
    );
    sql.push_str(&where_sql);
    sql.push_str(" ORDER BY n.created_at DESC LIMIT $2 OFFSET $3");
    let (limit, offset) = crate::pagination::page_params(q.limit, q.offset);
    let limit = limit.unwrap_or(50);
    let rows = sqlx::query_as::<_, Notification>(&sql)
        .bind(actor_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;
    Ok((crate::pagination::total_header(total), Json(rows)))
}

async fn unread_count(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(actor_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "unread": count })))
}

async fn mark_read(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(nid): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query(
        "UPDATE notifications SET read_at = COALESCE(read_at, NOW()) \
         WHERE id = $1 AND user_id = $2",
    )
    .bind(nid)
    .bind(actor_id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("notification not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_all_read(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL")
        .bind(actor_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
