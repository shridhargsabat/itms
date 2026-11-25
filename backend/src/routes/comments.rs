// Ticket comments + activity timeline + attachments (P1-1, issue #42).
// Comment thread with optional mentions, attachments stored on the uploads
// volume (10 MB per-file cap), who-changed-what timeline served from the
// existing audit_logs table.

use std::path::PathBuf;

use axum::{
    extract::{DefaultBodyLimit, Extension, Multipart, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::write,
    db::AppState,
    models::{CreateCommentRequest, TicketAttachment, TicketComment},
};
use super::{notifications::notify, AppError, UuidPath};

const MAX_ATTACHMENT_BYTES: i64 = 10 * 1024 * 1024; // 10 MB
/// TBE-13: bounded thread/timeline reads (pageable, ~100 default).
const DEFAULT_THREAD_LIMIT: i64 = 100;
const MAX_THREAD_LIMIT: i64 = 500;
/// Comment body mirrors CHECK(char_length(body) <= 4000) (TBE-22: 422).
const MAX_COMMENT_CHARS: usize = 4000;

/// Strict allowlist for attachment content types. Deliberately excludes
/// `text/html` / scripts: a stored MIME is later reflected as the download
/// Content-Type, so anything outside this list falls back to
/// `application/octet-stream`.
const ALLOWED_CONTENT_TYPES: &[&str] = &[
    "application/pdf",
    "application/json",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/octet-stream",
];

/// Normalize a client-supplied Content-Type: strip parameters (`; charset=…`),
/// lowercase, and keep it only when allowlisted — otherwise fall back to
/// `application/octet-stream`. Never fails.
fn sanitize_content_type(raw: Option<&str>) -> String {
    let normalized = raw
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if ALLOWED_CONTENT_TYPES.contains(&normalized.as_str()) {
        normalized
    } else {
        "application/octet-stream".to_string()
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{ticket_id}/comments", get(list_comments).post(create_comment))
        .route("/{ticket_id}/comments/{comment_id}", delete(delete_comment))
        .route("/{ticket_id}/attachments", post(upload_attachment))
        .route("/{ticket_id}/attachments/{attachment_id}", delete(delete_attachment))
        .route("/{ticket_id}/timeline", get(ticket_timeline))
        .layer(DefaultBodyLimit::max(MAX_ATTACHMENT_BYTES as usize + 1024 * 1024))
}

/// TBE-13: `?limit=&offset=` for thread/timeline reads; default 100, max 500.
#[derive(Debug, Deserialize)]
pub struct ThreadListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn parse_thread_page(p: &ThreadListParams) -> Result<(i64, i64), AppError> {
    let limit = match p.limit {
        None => DEFAULT_THREAD_LIMIT,
        Some(n) if n <= 0 => {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "limit must be a positive integer",
            ))
        }
        Some(n) => n.min(MAX_THREAD_LIMIT),
    };
    Ok((limit, p.offset.unwrap_or(0).max(0)))
}

async fn ensure_ticket(pool: &sqlx::PgPool, ticket_id: Uuid) -> Result<Option<(String, String)>, AppError> {
    let row: Option<(String, String)> = sqlx::query_as::<_, (String, String)>(
        "SELECT title, status FROM tickets WHERE id = $1",
    )
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// TBE-05: CLOSED tickets reject comment/attachment mutations (422);
/// RESOLVED stays mutable.
fn reject_when_closed(status: &str) -> Result<(), AppError> {
    if status == "CLOSED" {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ticket is closed — reopen it before adding comments or attachments",
        ));
    }
    Ok(())
}

// ── comments ────────────────────────────────────────────────────────────────

async fn list_comments(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    Query(params): Query<ThreadListParams>,
) -> Result<Json<Vec<TicketComment>>, AppError> {
    let pool = &state.pool;
    // TBE-06: non-staff see threads only on their own/participated tickets.
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    if ensure_ticket(pool, ticket_id).await?.is_none() {
        return Err(AppError::not_found("ticket not found"));
    }
    let (limit, offset) = parse_thread_page(&params)?;
    let rows = sqlx::query_as::<_, TicketComment>(
        "SELECT c.id, c.ticket_id, c.author_id, c.body, c.mentions, c.created_at, \
                u.name AS author_name, u.role AS author_role \
         FROM ticket_comments c JOIN users u ON u.id = c.author_id \
         WHERE c.ticket_id = $1 ORDER BY c.created_at ASC, c.id ASC LIMIT $2 OFFSET $3",
    )
    .bind(ticket_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(Json(rows))
}

async fn create_comment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    Json(body): Json<CreateCommentRequest>,
) -> Result<(StatusCode, Json<TicketComment>), AppError> {
    let pool = &state.pool;
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    let subject = ensure_ticket(pool, ticket_id).await?;
    let Some((subject, status)) = subject else {
        return Err(AppError::not_found("ticket not found"));
    };
    reject_when_closed(&status)?;
    let body_text = body.body.trim();
    // TBE-22: body-validation failures are 422 (were 400).
    if body_text.is_empty() {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "comment body is required"));
    }
    if body_text.chars().count() > MAX_COMMENT_CHARS {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("comment exceeds {MAX_COMMENT_CHARS} chars"),
        ));
    }
    // TBE-12: dedupe first — `mentions:[u,u]` must not false-400 on the
    // COUNT check — then union mentions into the notify list below.
    let mut mentions = body.mentions.clone();
    mentions.sort();
    mentions.dedup();
    let mentions_json = if mentions.is_empty() {
        json!([])
    } else {
        let found: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE id = ANY($1::uuid[])",
        )
        .bind(&mentions)
        .fetch_one(pool)
        .await?;
        if found as usize != mentions.len() {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "one or more mentioned users do not exist",
            ));
        }
        json!(mentions.iter().map(|u| u.to_string()).collect::<Vec<_>>())
    };

    let comment = sqlx::query_as::<_, TicketComment>(
        "INSERT INTO ticket_comments (ticket_id, author_id, body, mentions) \
         VALUES ($1, $2, $3, $4) \
         RETURNING id, ticket_id, author_id, body, mentions, created_at, \
                   (SELECT name FROM users WHERE id = $2) AS author_name, \
                   (SELECT role FROM users WHERE id = $2) AS author_role",
    )
    .bind(ticket_id)
    .bind(actor_id)
    .bind(body_text)
    .bind(&mentions_json)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        // TBE-26: author/ticket FK race → 422, not 500.
        if let sqlx::Error::Database(db) = &e {
            if db.code().as_deref() == Some("23503") {
                return AppError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "ticket or author no longer exists",
                );
            }
        }
        AppError::from(e)
    })?;

    write(
        pool,
        Some(actor_id),
        "TICKET_COMMENT",
        "ticket",
        ticket_id,
        json!({"subject": subject, "comment": comment.id.to_string(), "mentions": mentions.len()}),
    )
    .await?;

    // P1-2: notify requester + assignee + prior commenters + mentioned users
    // (skip the author). TBE-12: mentions were previously never notified.
    let mut recipients: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM (
            SELECT requester_id AS user_id FROM tickets WHERE id = $1
            UNION SELECT assignee_id FROM tickets WHERE id = $1 AND assignee_id IS NOT NULL
            UNION SELECT author_id FROM ticket_comments WHERE ticket_id = $1
         ) p WHERE user_id IS NOT NULL AND user_id <> $2",
    )
    .bind(ticket_id)
    .bind(actor_id)
    .fetch_all(pool)
    .await?;
    for m in &mentions {
        if *m != actor_id && !recipients.contains(m) {
            recipients.push(*m);
        }
    }
    for uid in recipients {
        notify(
            pool,
            uid,
            "TICKET_COMMENT",
            &format!("New comment on {}", subject),
            body_text,
            "ticket",
            ticket_id,
        )
        .await;
    }

    Ok((StatusCode::CREATED, Json(comment)))
}

async fn delete_comment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath((ticket_id, comment_id)): UuidPath<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    let row: Option<(String, String, Uuid, String,)> = sqlx::query_as::<_, (String, String, Uuid, String)>(
        "SELECT c.body, t.title, c.author_id, t.status FROM ticket_comments c \
         JOIN tickets t ON t.id = c.ticket_id WHERE c.id = $1 AND c.ticket_id = $2",
    )
    .bind(comment_id)
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    let Some((body, subject, author, status)) = row else {
        return Err(AppError::not_found("comment not found"));
    };
    reject_when_closed(&status)?;
    let user_role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if author != actor_id && user_role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only the author or an admin can delete a comment"));
    }
    sqlx::query("DELETE FROM ticket_comments WHERE id = $1")
        .bind(comment_id)
        .execute(pool)
        .await?;
    write(
        pool,
        Some(actor_id),
        "TICKET_COMMENT_DELETE",
        "ticket",
        ticket_id,
        json!({"subject": subject, "body": body.chars().take(80).collect::<String>()}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── attachments ─────────────────────────────────────────────────────────────

async fn upload_attachment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<TicketAttachment>), AppError> {
    let pool = &state.pool;
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    let subject = ensure_ticket(pool, ticket_id).await?;
    let Some((subject, status)) = subject else {
        return Err(AppError::not_found("ticket not found"));
    };
    reject_when_closed(&status)?;
    let dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/uploads".to_string());
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot create upload dir: {e}"))
    })?;

    let mut file_name: Option<String> = None;
    let mut content_type: Option<String> = None;
    let mut data: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        // axum's DefaultBodyLimit aborts the stream with a generic parse error
        // when the body exceeds the limit — surface 413, not 400. (A precise
        // cause isn't reachable: MultipartError doesn't expose its source.)
        if e.to_string().contains("multipart") {
            AppError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "file exceeds 10 MB limit",
            )
        } else {
            AppError::new(StatusCode::BAD_REQUEST, format!("multipart error: {e}"))
        }
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(|s| s.to_string());
                content_type = field.content_type().map(|s| s.to_string());
                let bytes = field.bytes().await.map_err(|e| {
                    // DefaultBodyLimit aborts mid-read when the field exceeds
                    // the limit — surface 413, not 400.
                    if e.to_string().contains("multipart") || e.to_string().contains("length limit") {
                        AppError::new(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "file exceeds 10 MB limit",
                        )
                    } else {
                        AppError::new(StatusCode::BAD_REQUEST, format!("read error: {e}"))
                    }
                })?;
                if bytes.len() as i64 > MAX_ATTACHMENT_BYTES {
                    return Err(AppError::new(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        format!("file exceeds 10 MB limit ({} bytes)", bytes.len()),
                    ));
                }
                data = Some(bytes.to_vec());
            }
            _ => {}
        }
    }
    let Some(file_name) = file_name else {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "missing file field"));
    };
    let Some(data) = data else {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "empty file body"));
    };
    if data.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "file is empty"));
    }
    // sanitize filename: keep basename only
    let clean = file_name.rsplit(['/', '\\']).next().unwrap_or(&file_name).to_string();
    let clean = clean.chars().filter(|c| !c.is_control()).take(200).collect::<String>();
    if clean.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "invalid file name"));
    }
    // Validate the client-supplied MIME against the strict allowlist (unknown
    // or missing → octet-stream fallback), so downloads never reflect an
    // attacker-chosen Content-Type.
    let content_type = sanitize_content_type(content_type.as_deref());
    let storage_key = format!("{ticket_id}/{}.bin", Uuid::new_v4());
    let abs = PathBuf::from(&dir).join(&storage_key);
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot create dir: {e}"))
        })?;
    }
    tokio::fs::write(&abs, &data).await.map_err(|e| {
        AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("cannot store file: {e}"))
    })?;

    let att = sqlx::query_as::<_, TicketAttachment>(
        "INSERT INTO ticket_attachments (ticket_id, uploader_id, file_name, content_type, size_bytes, storage_key) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, ticket_id, uploader_id, file_name, content_type, size_bytes, storage_key, created_at, \
                   (SELECT name FROM users WHERE id = $2) AS uploader_name",
    )
    .bind(ticket_id)
    .bind(actor_id)
    .bind(&clean)
    .bind(&content_type)
    .bind(data.len() as i64)
    .bind(&storage_key)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "TICKET_ATTACH",
        "ticket",
        ticket_id,
        json!({"subject": subject, "file": clean, "bytes": data.len()}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(att)))
}

async fn delete_attachment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath((ticket_id, attachment_id)): UuidPath<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    let row: Option<(String, String, String, Uuid, String,)> = sqlx::query_as::<_, (String, String, String, Uuid, String)>(
        "SELECT a.file_name, a.storage_key, t.title, a.uploader_id, t.status FROM ticket_attachments a \
         JOIN tickets t ON t.id = a.ticket_id WHERE a.id = $1 AND a.ticket_id = $2",
    )
    .bind(attachment_id)
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    let Some((file_name, storage_key, subject, uploader, status)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    reject_when_closed(&status)?;
    let user_role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if uploader != actor_id && user_role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only the uploader or an admin can delete an attachment"));
    }
    sqlx::query("DELETE FROM ticket_attachments WHERE id = $1")
        .bind(attachment_id)
        .execute(pool)
        .await?;
    let dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/uploads".to_string());
    let abs = PathBuf::from(&dir).join(&storage_key);
    if abs.exists() {
        let _ = tokio::fs::remove_file(&abs).await;
    }
    write(
        pool,
        Some(actor_id),
        "TICKET_ATTACH_DELETE",
        "ticket",
        ticket_id,
        json!({"subject": subject, "file": file_name}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Stream a stored attachment (auth via Bearer header, not query param).
/// TBE-06: scoped like every other ticket read — non-staff download only from
/// tickets they can see.
pub async fn download_attachment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(attachment_id): UuidPath<Uuid>,
) -> Result<Response, AppError> {
    let pool = &state.pool;
    let row: Option<(String, String, Option<String>, i64, Uuid,)> = sqlx::query_as::<_, (String, String, Option<String>, i64, Uuid)>(
        "SELECT file_name, storage_key, content_type, size_bytes, ticket_id FROM ticket_attachments WHERE id = $1",
    )
    .bind(attachment_id)
    .fetch_optional(pool)
    .await?;
    let Some((file_name, storage_key, content_type, size, ticket_id)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    let dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/uploads".to_string());
    let abs = PathBuf::from(&dir).join(&storage_key);
    let bytes = tokio::fs::read(&abs).await.map_err(|_| {
        AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "stored file missing on disk")
    })?;

    let mut headers = HeaderMap::new();
    // Re-sanitize the stored value (pre-hardening rows may hold anything) and
    // never unwrap header parsing — fall back instead of panicking the worker.
    let ct = sanitize_content_type(content_type.as_deref());
    headers.insert(
        header::CONTENT_TYPE,
        ct.parse()
            .unwrap_or_else(|_| header::HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name.replace('"', "_"))
            .parse()
            .unwrap_or_else(|_| header::HeaderValue::from_static("attachment")),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        size.to_string()
            .parse()
            .unwrap_or_else(|_| header::HeaderValue::from_static("0")),
    );
    Ok((headers, bytes).into_response())
}

// ── timeline (comments ∪ audit changes) ─────────────────────────────────────

async fn ticket_timeline(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Extension(role): Extension<String>,
    UuidPath(ticket_id): UuidPath<Uuid>,
    Query(params): Query<ThreadListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    super::tickets::ensure_ticket_visible(pool, ticket_id, actor_id, &role).await?;
    if ensure_ticket(pool, ticket_id).await?.is_none() {
        return Err(AppError::not_found("ticket not found"));
    }
    // TBE-13: every section bounded + id-tiebroken (bulk/cron inserts can
    // share a created_at, making created_at-only order nondeterministic).
    let (limit, offset) = parse_thread_page(&params)?;
    let comments: Vec<TicketComment> = sqlx::query_as::<_, TicketComment>(
        "SELECT c.id, c.ticket_id, c.author_id, c.body, c.mentions, c.created_at, \
                u.name AS author_name, u.role AS author_role \
         FROM ticket_comments c JOIN users u ON u.id = c.author_id \
         WHERE c.ticket_id = $1 ORDER BY c.created_at ASC, c.id ASC LIMIT $2 OFFSET $3",
    )
    .bind(ticket_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    // who-changed-what: audit entries for this ticket (TICKET_* actions)
    let changes: Vec<serde_json::Value> = sqlx::query_as::<_, (Uuid, Option<String>, String, chrono::DateTime<chrono::Utc>, serde_json::Value)>(
        "SELECT al.id, u.name, al.action, al.created_at, COALESCE(al.diff, '{}'::jsonb) \
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id \
         WHERE al.target_type = 'ticket' AND al.target_id = $1 \
           AND (al.action LIKE 'TICKET_%' OR al.action = 'SLA_ESCALATE') \
         ORDER BY al.created_at ASC, al.id ASC LIMIT $2 OFFSET $3",
    )
    .bind(ticket_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, name, action, at, details)| {
        json!({
            "id": id,
            "kind": "change",
            "actor": name.unwrap_or_else(|| "System".to_string()),
            "action": action,
            "at": at,
            "details": details,
        })
    })
    .collect();

    Ok(Json(json!({
        "comments": comments,
        "changes": changes,
        "attachments": sqlx::query_as::<_, TicketAttachment>(
            "SELECT a.id, a.ticket_id, a.uploader_id, a.file_name, a.content_type, a.size_bytes, a.storage_key, a.created_at, \
                    u.name AS uploader_name \
             FROM ticket_attachments a JOIN users u ON u.id = a.uploader_id \
             WHERE a.ticket_id = $1 ORDER BY a.created_at ASC, a.id ASC LIMIT $2 OFFSET $3",
        )
        .bind(ticket_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_type_allowlist_keeps_known_types() {
        assert_eq!(sanitize_content_type(Some("application/pdf")), "application/pdf");
        assert_eq!(sanitize_content_type(Some("image/png")), "image/png");
        assert_eq!(sanitize_content_type(Some("text/csv")), "text/csv");
    }

    #[test]
    fn content_type_normalizes_case_and_params() {
        assert_eq!(sanitize_content_type(Some("Image/JPEG")), "image/jpeg");
        assert_eq!(
            sanitize_content_type(Some("text/plain; charset=utf-8")),
            "text/plain"
        );
        assert_eq!(sanitize_content_type(Some("  application/pdf  ")), "application/pdf");
    }

    #[test]
    fn content_type_falls_back_for_unknown_or_missing() {
        // text/html is deliberately NOT allowlisted (reflected-MIME XSS risk).
        assert_eq!(sanitize_content_type(Some("text/html")), "application/octet-stream");
        assert_eq!(
            sanitize_content_type(Some("application/x-sh")),
            "application/octet-stream"
        );
        assert_eq!(sanitize_content_type(Some("not a mime\ninjected: x")), "application/octet-stream");
        assert_eq!(sanitize_content_type(None), "application/octet-stream");
        assert_eq!(sanitize_content_type(Some("")), "application/octet-stream");
    }

    #[test]
    fn thread_paging_defaults_caps_and_rejects_zero() {
        let (l, o) = parse_thread_page(&ThreadListParams { limit: None, offset: None }).unwrap();
        assert_eq!((l, o), (100, 0));
        let (l, o) = parse_thread_page(&ThreadListParams { limit: Some(9999), offset: Some(-5) }).unwrap();
        assert_eq!((l, o), (500, 0));
        let err = parse_thread_page(&ThreadListParams { limit: Some(0), offset: None }).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn closed_guard_blocks_mutations_but_allows_resolved() {
        assert!(reject_when_closed("CLOSED").is_err());
        assert_eq!(
            reject_when_closed("CLOSED").unwrap_err().status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert!(reject_when_closed("RESOLVED").is_ok());
        assert!(reject_when_closed("OPEN").is_ok());
    }
}
