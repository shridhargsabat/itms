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

/// VARCHAR caps from migration 0010 — notify() truncates to these so a
/// long-titled ticket or user never drops notices (#136 R2-BE-03).
/// tickets.title allows 255 chars but notifications.title only 200, and
/// users.name allows 255 while pending_emails.to_name only 120.
const NOTIFICATION_TITLE_MAX: usize = 200;
const EMAIL_SUBJECT_MAX: usize = 255;
const EMAIL_TO_NAME_MAX: usize = 120;

/// Hard-cut truncation by character count (no marker). Cuts on char
/// boundaries, so multibyte UTF-8 is never split mid-code-point.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => s[..idx].to_owned(),
        None => s.to_owned(),
    }
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
    // #136 R2-BE-03: truncate to the VARCHAR caps — a 255-char ticket
    // title would otherwise overflow notifications.title (200) and the
    // whole notice (in-app AND email) would be dropped.
    let title_trunc = truncate_chars(title, NOTIFICATION_TITLE_MAX);
    let res = sqlx::query(
        "INSERT INTO notifications (user_id, kind, title, body, ref_type, ref_id) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(user_id)
    .bind(kind)
    .bind(&title_trunc)
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
        // #136: "[ITMS] " + a long title overflows subject (255), and
        // users.name (255) overflows to_name (120) — truncate both.
        let subject = truncate_chars(&format!("[ITMS] {title}"), EMAIL_SUBJECT_MAX);
        let to_name = name.as_deref().map(|n| truncate_chars(n, EMAIL_TO_NAME_MAX));
        let body = format!(
            "{body}\n\n—\nITMS {ref_type} {ref_id}\nhttps://itms.ai-automation-hub.tech"
        );
        let res = sqlx::query(
            "INSERT INTO pending_emails (to_email, to_name, subject, body, kind, ref_type, ref_id) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&to)
        .bind(to_name)
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

/// R2 P2 regression tests (issue #136 R2-BE-03): notify() truncates to the
/// VARCHAR caps instead of dropping long-titled notices. DB-backed tests
/// use the same TEST_DATABASE_URL-with-skip pattern as intake's
/// r2_regression_tests so `cargo test` stays green without a database.
#[cfg(test)]
mod r2_p2_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test@127.0.0.1:55434/itms_test";

    async fn test_pool() -> Option<PgPool> {
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
                eprintln!("r2_p2_regression_tests (notifications): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    #[test]
    fn truncate_chars_cuts_on_char_boundaries() {
        assert_eq!(truncate_chars("", 5), "");
        assert_eq!(truncate_chars("abc", 5), "abc");
        assert_eq!(truncate_chars("abcde", 5), "abcde");
        assert_eq!(truncate_chars("abcdef", 5), "abcde");
        // multibyte: 5 e-acutes cut to 3 chars, still valid UTF-8
        assert_eq!(truncate_chars("ééééé", 3), "ééé");
        assert_eq!(truncate_chars("ééééé", 3).chars().count(), 3);
        // caps match migration 0010 — change the migration first if these move
        assert_eq!(NOTIFICATION_TITLE_MAX, 200);
        assert_eq!(EMAIL_SUBJECT_MAX, 255);
        assert_eq!(EMAIL_TO_NAME_MAX, 120);
    }

    #[tokio::test]
    async fn notify_truncates_255_char_ticket_title_and_long_name() {
        let Some(pool) = test_pool().await else { return };
        let uniq = Uuid::new_v4().simple().to_string();
        // real (non-@itms.local) address so the email branch runs; 150-char
        // name fits users.name (255) but overflows to_name (120)
        let email = format!("r2-p2-notify-{uniq}@example.com");
        let long_name = "N".repeat(150);
        let uid: Uuid = sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash, active) \
             VALUES ($1, $2, 'EMPLOYEE', 'IT', 'test-hash', TRUE) RETURNING id",
        )
        .bind(&long_name)
        .bind(&email)
        .fetch_one(&pool)
        .await
        .unwrap();

        // real ticket with a max-length (255) title — the old code dropped
        // both the notification and the queued email for it
        let title255 = "T".repeat(255);
        let number = format!("INC-8{uniq}");
        let tid: Uuid = sqlx::query_scalar(
            "INSERT INTO tickets (ticket_number, title, description, requester_id) \
             VALUES ($1, $2, 'truncate test', $3) RETURNING id",
        )
        .bind(&number)
        .bind(&title255)
        .bind(uid)
        .fetch_one(&pool)
        .await
        .unwrap();

        notify(&pool, uid, "TEST_TRUNCATE", &title255, "hello", "ticket", tid).await;

        let stored_title: String = sqlx::query_scalar(
            "SELECT title FROM notifications WHERE user_id = $1 AND ref_id = $2 \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(uid)
        .bind(tid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored_title, "T".repeat(200), "notification title must be cut to VARCHAR(200)");

        let row: (String, Option<String>) = sqlx::query_as(
            "SELECT subject, to_name FROM pending_emails WHERE ref_id = $1 \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(tid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0.chars().count(), 255, "subject must be cut to VARCHAR(255)");
        assert!(row.0.starts_with("[ITMS] "), "subject keeps its prefix: {}", row.0);
        assert_eq!(row.1, Some("N".repeat(120)), "to_name must be cut to VARCHAR(120)");
    }
}
