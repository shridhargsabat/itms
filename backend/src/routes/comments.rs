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
/// R2-BE-15 (#162): mentions capped at 20 (422 past the cap).
const MAX_MENTIONS: usize = 20;

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
/// R2-BE-13 (#160): raw strings parsed manually so `?limit=abc` is a 422 with
/// a message (tickets-list pattern), not axum's bare 400.
#[derive(Debug, Deserialize)]
pub struct ThreadListParams {
    pub limit: Option<String>,
    pub offset: Option<String>,
}

fn parse_thread_page(p: &ThreadListParams) -> Result<(i64, i64), AppError> {
    let limit = match p.limit.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => DEFAULT_THREAD_LIMIT,
        Some(s) => match s.parse::<i64>() {
            Ok(n) if n >= 1 => n.min(MAX_THREAD_LIMIT),
            _ => {
                return Err(AppError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("invalid limit: {s} (expected a positive integer)"),
                ))
            }
        },
    };
    let offset = match p.offset.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => 0,
        Some(s) => match s.parse::<i64>() {
            Ok(n) => n.max(0),
            Err(_) => {
                return Err(AppError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("invalid offset: {s} (expected an integer >= 0)"),
                ))
            }
        },
    };
    Ok((limit, offset))
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

/// R2-BE-07 (#140): lock the ticket row FOR UPDATE inside the caller's tx and
/// return `(title, status)` — the ticket-PATCH pattern. Holding the row lock
/// from the closed check through the mutation serializes against a concurrent
/// PATCH-to-CLOSED instead of racing it. 404 when the ticket is gone
/// (ticket-delete race).
async fn lock_ticket_for_mutation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ticket_id: Uuid,
) -> Result<(String, String), AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT title, status FROM tickets WHERE id = $1 FOR UPDATE")
            .bind(ticket_id)
            .fetch_optional(&mut **tx)
            .await?;
    row.ok_or_else(|| AppError::not_found("ticket not found"))
}

/// R2-BE-08 (#141): per-ticket attachment quota — 20 files / 100 MB total.
const MAX_ATTACHMENTS_PER_TICKET: i64 = 20;
const MAX_ATTACHMENT_TOTAL_BYTES: i64 = 100 * 1024 * 1024;

/// Quota check, called inside the row-locked tx so parallel uploads can't
/// each pass the check and jointly overshoot. File-count overage is 422
/// (validation); byte overage is 413 (matches the per-file 413 above).
async fn check_attachment_quota(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ticket_id: Uuid,
    new_bytes: i64,
) -> Result<(), AppError> {
    // NOTE: SUM(bigint) returns NUMERIC in Postgres — cast back to BIGINT so
    // the row decodes as (i64, i64).
    let row: (i64, i64) =
        sqlx::query_as("SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)::BIGINT FROM ticket_attachments WHERE ticket_id = $1")
            .bind(ticket_id)
            .fetch_one(&mut **tx)
            .await?;
    if row.0 >= MAX_ATTACHMENTS_PER_TICKET {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("attachment limit reached: ticket already has {MAX_ATTACHMENTS_PER_TICKET} files"),
        ));
    }
    if row.1 + new_bytes > MAX_ATTACHMENT_TOTAL_BYTES {
        return Err(AppError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "attachment quota exceeded: ticket already stores 100 MB",
        ));
    }
    Ok(())
}

/// R2-BE-08 (#141): TBE-26 pattern for attachment inserts — a ticket deleted
/// between the visibility check and the INSERT is 404 (it's gone), a vanished
/// uploader is 422 (stale actor). Never 500.
fn map_attachment_fk_violation(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &err {
        let is_fk = db.code().as_deref() == Some("23503")
            || db.constraint().is_some_and(|c| c.contains("fkey"));
        if is_fk {
            // Auto-named constraint: ticket_attachments_ticket_id_fkey.
            if db.constraint().is_some_and(|c| c.contains("ticket_id")) {
                return AppError::not_found("ticket not found");
            }
            return AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "uploader no longer exists");
        }
    }
    AppError::from(err)
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
    // Cheap validation runs before the row lock (ticket-PATCH pattern): the
    // lock is held only around the guarded mutation, not request parsing.
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
    // R2-BE-15 (#162): cap at 20 + active-only (422 on inactive).
    let mut mentions = body.mentions.clone();
    mentions.sort();
    mentions.dedup();
    if mentions.len() > MAX_MENTIONS {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("too many mentions (maximum {MAX_MENTIONS})"),
        ));
    }
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
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE id = ANY($1::uuid[]) AND active = TRUE",
        )
        .bind(&mentions)
        .fetch_one(pool)
        .await?;
        if active as usize != mentions.len() {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "one or more mentioned users are inactive",
            ));
        }
        json!(mentions.iter().map(|u| u.to_string()).collect::<Vec<_>>())
    };

    // R2-BE-07 (#140): lock the ticket row FOR UPDATE inside a tx so a
    // concurrent PATCH-to-CLOSED serializes before the closed check instead
    // of racing it (same pattern as the ticket PATCH handlers).
    let mut tx = pool.begin().await?;
    let (subject, status) = lock_ticket_for_mutation(&mut tx, ticket_id).await?;
    reject_when_closed(&status)?;

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
    .fetch_one(&mut *tx)
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
        &mut *tx,
        Some(actor_id),
        "TICKET_COMMENT",
        "ticket",
        ticket_id,
        json!({"subject": subject, "comment": comment.id.to_string(), "mentions": mentions.len()}),
    )
    .await?;
    tx.commit().await?;

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
    // R2-BE-07 (#140): comment lookup + ticket row lock + delete + audit in
    // one tx — a concurrent PATCH-to-CLOSED can't slip between the closed
    // check and the delete.
    let mut tx = pool.begin().await?;
    let row: Option<(String, Uuid)> = sqlx::query_as::<_, (String, Uuid)>(
        "SELECT c.body, c.author_id FROM ticket_comments c WHERE c.id = $1 AND c.ticket_id = $2",
    )
    .bind(comment_id)
    .bind(ticket_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((body, author)) = row else {
        return Err(AppError::not_found("comment not found"));
    };
    let (subject, status) = lock_ticket_for_mutation(&mut tx, ticket_id).await?;
    reject_when_closed(&status)?;
    let user_role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(&mut *tx)
        .await?;
    if author != actor_id && user_role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only the author or an admin can delete a comment"));
    }
    sqlx::query("DELETE FROM ticket_comments WHERE id = $1")
        .bind(comment_id)
        .execute(&mut *tx)
        .await?;
    write(
        &mut *tx,
        Some(actor_id),
        "TICKET_COMMENT_DELETE",
        "ticket",
        ticket_id,
        json!({"subject": subject, "body": body.chars().take(80).collect::<String>()}),
    )
    .await?;
    tx.commit().await?;
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
    // NOTE: the ticket existence/closed checks happen below inside the
    // row-locked tx (R2-BE-07), after the multipart body is fully parsed, so
    // the lock is never held across slow request-body reads.
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
        if name.as_str() == "file" {
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

    // R2-BE-07 (#140) + R2-BE-08 (#141): lock the ticket row, re-check
    // CLOSED, then enforce the per-ticket quota — all inside one tx so a
    // concurrent PATCH-to-CLOSED or a parallel upload can't race the checks.
    let mut tx = pool.begin().await?;
    let (subject, status) = lock_ticket_for_mutation(&mut tx, ticket_id).await?;
    reject_when_closed(&status)?;
    check_attachment_quota(&mut tx, ticket_id, data.len() as i64).await?;

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

    // R2-BE-08 (#141): the bytes land on disk before their row exists — every
    // failure below removes the just-written file so failures leave no
    // orphaned files behind.
    let att = match sqlx::query_as::<_, TicketAttachment>(
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
    .fetch_one(&mut *tx)
    .await
    {
        Ok(att) => att,
        Err(e) => {
            let _ = tokio::fs::remove_file(&abs).await;
            return Err(map_attachment_fk_violation(e));
        }
    };

    if let Err(e) = write(
        &mut *tx,
        Some(actor_id),
        "TICKET_ATTACH",
        "ticket",
        ticket_id,
        json!({"subject": subject, "file": clean, "bytes": data.len()}),
    )
    .await
    {
        let _ = tokio::fs::remove_file(&abs).await;
        return Err(AppError::from(e));
    }
    if let Err(e) = tx.commit().await {
        let _ = tokio::fs::remove_file(&abs).await;
        return Err(AppError::from(e));
    }
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
    // R2-BE-07 (#140): attachment lookup + ticket row lock + delete + audit
    // in one tx — a concurrent PATCH-to-CLOSED can't slip between the closed
    // check and the delete.
    let mut tx = pool.begin().await?;
    let row: Option<(String, String, Uuid)> = sqlx::query_as::<_, (String, String, Uuid)>(
        "SELECT a.file_name, a.storage_key, a.uploader_id FROM ticket_attachments a \
         WHERE a.id = $1 AND a.ticket_id = $2",
    )
    .bind(attachment_id)
    .bind(ticket_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((file_name, storage_key, uploader)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    let (subject, status) = lock_ticket_for_mutation(&mut tx, ticket_id).await?;
    reject_when_closed(&status)?;
    let user_role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(&mut *tx)
        .await?;
    if uploader != actor_id && user_role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "only the uploader or an admin can delete an attachment"));
    }
    sqlx::query("DELETE FROM ticket_attachments WHERE id = $1")
        .bind(attachment_id)
        .execute(&mut *tx)
        .await?;
    write(
        &mut *tx,
        Some(actor_id),
        "TICKET_ATTACH_DELETE",
        "ticket",
        ticket_id,
        json!({"subject": subject, "file": file_name}),
    )
    .await?;
    tx.commit().await?;
    let dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/uploads".to_string());
    let abs = PathBuf::from(&dir).join(&storage_key);
    if abs.exists() {
        let _ = tokio::fs::remove_file(&abs).await;
    }
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
        let (l, o) = parse_thread_page(&ThreadListParams {
            limit: Some("9999".to_string()),
            offset: Some("-5".to_string()),
        })
        .unwrap();
        assert_eq!((l, o), (500, 0));
        let err = parse_thread_page(&ThreadListParams {
            limit: Some("0".to_string()),
            offset: None,
        })
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn be13_thread_paging_rejects_garbage_with_422() {
        // R2-BE-13 (#160): ?limit=abc / ?offset=abc are 422, not axum 400.
        // The struct itself accepts arbitrary strings (Query won't 400 first).
        let p: ThreadListParams = serde_json::from_value(serde_json::json!({"limit": "abc"})).unwrap();
        assert_eq!(p.limit.as_deref(), Some("abc"));
        let p: ThreadListParams =
            serde_json::from_value(serde_json::json!({"limit": "abc", "offset": "abc"})).unwrap();
        assert!(parse_thread_page(&p).unwrap_err().status == StatusCode::UNPROCESSABLE_ENTITY);
        for bad in ["abc", "10x", "1.5", "all", "-3", "0"] {
            let err = parse_thread_page(&ThreadListParams {
                limit: Some(bad.to_string()),
                offset: None,
            })
            .unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "limit={bad:?}");
        }
        for bad in ["abc", "1.5", "10x"] {
            let err = parse_thread_page(&ThreadListParams {
                limit: None,
                offset: Some(bad.to_string()),
            })
            .unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "offset={bad:?}");
        }
        // Empty/whitespace behave as absent (defaults).
        let (l, o) = parse_thread_page(&ThreadListParams {
            limit: Some("".to_string()),
            offset: Some("   ".to_string()),
        })
        .unwrap();
        assert_eq!((l, o), (100, 0));
        // Valid strings still work (trimmed).
        let (l, o) = parse_thread_page(&ThreadListParams {
            limit: Some(" 25 ".to_string()),
            offset: Some(" 3 ".to_string()),
        })
        .unwrap();
        assert_eq!((l, o), (25, 3));
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

/// R2 P2 regression tests (issues #140 R2-BE-07, #141 R2-BE-08): DB-backed
/// handler tests. Same TEST_DATABASE_URL-with-skip pattern as
/// routes::intake::r2_regression_tests — when no test DB is reachable they
/// skip (pass with a notice) so `cargo test` stays green without a database.
#[cfg(test)]
mod r2_p2_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test@127.0.0.1:55434/itms_test";

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
                eprintln!("r2_p2_regression_tests(comments): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn create_user(pool: &sqlx::PgPool, role: &str) -> Uuid {
        let email = format!("r2p2-c-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash, active) \
             VALUES ('R2P2 Comments', $1, $2, 'IT', 'test-hash', TRUE) RETURNING id",
        )
        .bind(&email)
        .bind(role)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn create_ticket(pool: &sqlx::PgPool, requester: Uuid, status: &str) -> Uuid {
        let number = format!("INC-8{:09}", rand::random::<u32>() % 1_000_000_000);
        sqlx::query_scalar(
            "INSERT INTO tickets (ticket_number, title, description, requester_id, status) \
             VALUES ($1, 'r2p2', 'r2p2', $2, $3) RETURNING id",
        )
        .bind(&number)
        .bind(requester)
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn create_comment_row(pool: &sqlx::PgPool, ticket: Uuid, author: Uuid) -> Uuid {
        sqlx::query_scalar("INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES ($1, $2, 'seed') RETURNING id")
            .bind(ticket)
            .bind(author)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn create_attachment_row(pool: &sqlx::PgPool, ticket: Uuid, uploader: Uuid, size: i64) -> Uuid {
        let key = format!("r2p2-c-{}", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO ticket_attachments (ticket_id, uploader_id, file_name, size_bytes, storage_key) \
             VALUES ($1, $2, 'seed.bin', $3, $4) RETURNING id",
        )
        .bind(ticket)
        .bind(uploader)
        .bind(size)
        .bind(&key)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn comment_req(body: &str) -> Json<CreateCommentRequest> {
        Json(CreateCommentRequest { body: body.to_string(), mentions: vec![] })
    }

    // ── R2-BE-07: CLOSED-ticket rejection still holds through the tx path ───

    #[tokio::test]
    async fn closed_ticket_rejects_comment_create() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "CLOSED").await;

        let err = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req("should not land"),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("closed"), "message: {}", err.message);

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = $1")
            .bind(tid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(0, n);
    }

    #[tokio::test]
    async fn open_ticket_accepts_comment_create_with_audit() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;

        let (code, Json(c)) = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req("hello via tx path"),
        )
        .await
        .unwrap();
        assert_eq!(code, StatusCode::CREATED);
        assert_eq!(c.ticket_id, tid);
        let audit: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'TICKET_COMMENT' AND target_id = $1",
        )
        .bind(tid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(1, audit);
    }

    #[tokio::test]
    async fn closed_ticket_rejects_comment_delete() {
        let Some(pool) = test_pool().await else { return };
        let admin = create_user(&pool, "ADMIN").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "CLOSED").await;
        let cid = create_comment_row(&pool, tid, admin).await;

        let err = delete_comment(
            State(test_state(pool.clone())),
            Extension(admin),
            Extension("ADMIN".to_string()),
            UuidPath((tid, cid)),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("closed"), "message: {}", err.message);

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_comments WHERE id = $1")
            .bind(cid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(1, n);
    }

    #[tokio::test]
    async fn open_ticket_accepts_comment_delete_with_audit() {
        let Some(pool) = test_pool().await else { return };
        let admin = create_user(&pool, "ADMIN").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;
        let cid = create_comment_row(&pool, tid, admin).await;

        let code = delete_comment(
            State(test_state(pool.clone())),
            Extension(admin),
            Extension("ADMIN".to_string()),
            UuidPath((tid, cid)),
        )
        .await
        .unwrap();
        assert_eq!(code, StatusCode::NO_CONTENT);
        let audit: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'TICKET_COMMENT_DELETE' AND target_id = $1",
        )
        .bind(tid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(1, audit);
    }

    #[tokio::test]
    async fn closed_ticket_rejects_attachment_delete() {
        let Some(pool) = test_pool().await else { return };
        let admin = create_user(&pool, "ADMIN").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "CLOSED").await;
        let aid = create_attachment_row(&pool, tid, admin, 128).await;

        let err = delete_attachment(
            State(test_state(pool.clone())),
            Extension(admin),
            Extension("ADMIN".to_string()),
            UuidPath((tid, aid)),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("closed"), "message: {}", err.message);

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_attachments WHERE id = $1")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(1, n);
    }

    #[tokio::test]
    async fn lock_helper_surfaces_closed_status_and_404s_missing() {
        let Some(pool) = test_pool().await else { return };
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "CLOSED").await;

        let mut tx = pool.begin().await.unwrap();
        let (title, status) = lock_ticket_for_mutation(&mut tx, tid).await.unwrap();
        assert!(!title.is_empty());
        assert_eq!(status, "CLOSED");
        assert_eq!(
            reject_when_closed(&status).unwrap_err().status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let err = lock_ticket_for_mutation(&mut tx, Uuid::new_v4()).await.unwrap_err();
        assert_eq!(err.status, StatusCode::NOT_FOUND);
        tx.rollback().await.unwrap();
    }

    // ── R2-BE-08: quota enforcement ──────────────────────────────────────────

    #[tokio::test]
    async fn attachment_quota_count_returns_422_at_20_files() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;
        for _ in 0..20 {
            create_attachment_row(&pool, tid, staff, 10).await;
        }

        let mut tx = pool.begin().await.unwrap();
        let err = check_attachment_quota(&mut tx, tid, 10).await.unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("20"), "message: {}", err.message);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn attachment_quota_bytes_returns_413_over_100mb() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;
        create_attachment_row(&pool, tid, staff, 100 * 1024 * 1024).await;

        let mut tx = pool.begin().await.unwrap();
        let err = check_attachment_quota(&mut tx, tid, 1).await.unwrap_err();
        assert_eq!(err.status, StatusCode::PAYLOAD_TOO_LARGE);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn attachment_quota_allows_headroom() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;
        create_attachment_row(&pool, tid, staff, 1024).await;

        let mut tx = pool.begin().await.unwrap();
        check_attachment_quota(&mut tx, tid, 1024).await.unwrap();
        tx.rollback().await.unwrap();
    }

    // ── R2-BE-08: FK-violation mapping (TBE-26 pattern) ─────────────────────

    #[tokio::test]
    async fn attachment_fk_violation_maps_to_404_and_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT").await;
        let requester = create_user(&pool, "EMPLOYEE").await;
        let tid = create_ticket(&pool, requester, "OPEN").await;

        // Ticket-delete race → 404 (gone), not 500.
        let raw = sqlx::query(
            "INSERT INTO ticket_attachments (ticket_id, uploader_id, file_name, size_bytes, storage_key) \
             VALUES ($1, $2, 'race.bin', 1, $3)",
        )
        .bind(Uuid::new_v4())
        .bind(staff)
        .bind(format!("r2p2-c-{}", Uuid::new_v4().simple()))
        .execute(&pool)
        .await
        .unwrap_err();
        assert_eq!(map_attachment_fk_violation(raw).status, StatusCode::NOT_FOUND);

        // Vanished uploader → 422 (stale actor), not 500.
        let raw = sqlx::query(
            "INSERT INTO ticket_attachments (ticket_id, uploader_id, file_name, size_bytes, storage_key) \
             VALUES ($1, $2, 'race.bin', 1, $3)",
        )
        .bind(tid)
        .bind(Uuid::new_v4())
        .bind(format!("r2p2-c-{}", Uuid::new_v4().simple()))
        .execute(&pool)
        .await
        .unwrap_err();
        assert_eq!(
            map_attachment_fk_violation(raw).status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}

/// R2 P3 regression tests (issues #160 R2-BE-13, #162 R2-BE-15): DB-backed
/// handler tests. Same TEST_DATABASE_URL-with-skip pattern as
/// routes::intake::r2_regression_tests.
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
                eprintln!("r2_p3_regression_tests(comments): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn create_user(pool: &sqlx::PgPool, role: &str, active: bool) -> Uuid {
        let email = format!("r2p3-c-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash, active) \
             VALUES ('R2P3 Comments', $1, $2, 'IT', 'test-hash', $3) RETURNING id",
        )
        .bind(&email)
        .bind(role)
        .bind(active)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn create_ticket(pool: &sqlx::PgPool, requester: Uuid) -> Uuid {
        let number = format!("INC-6{:09}", rand::random::<u32>() % 1_000_000_000);
        sqlx::query_scalar(
            "INSERT INTO tickets (ticket_number, title, description, requester_id, status) \
             VALUES ($1, 'r2p3', 'r2p3', $2, 'OPEN') RETURNING id",
        )
        .bind(&number)
        .bind(requester)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn thread_query(limit: Option<&str>, offset: Option<&str>) -> Query<ThreadListParams> {
        Query(ThreadListParams {
            limit: limit.map(|s| s.to_string()),
            offset: offset.map(|s| s.to_string()),
        })
    }

    fn comment_req(mentions: Vec<Uuid>) -> Json<CreateCommentRequest> {
        Json(CreateCommentRequest { body: "r2p3 mention test".to_string(), mentions })
    }

    // ── R2-BE-13: thread/timeline garbage paging is 422 at the handler ──────

    #[tokio::test]
    async fn thread_limit_garbage_returns_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let tid = create_ticket(&pool, requester).await;

        for limit in [Some("abc"), Some("10x"), Some("1.5")] {
            let err = list_comments(
                State(test_state(pool.clone())),
                Extension(staff),
                Extension("AGENT".to_string()),
                UuidPath(tid),
                thread_query(limit, None),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY, "limit={limit:?}");
        }
        let err = list_comments(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            thread_query(None, Some("abc")),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn timeline_limit_garbage_returns_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let tid = create_ticket(&pool, requester).await;

        let err = ticket_timeline(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            thread_query(Some("abc"), None),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);

        // Valid paging still works.
        let out = ticket_timeline(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            thread_query(Some("10"), Some("0")),
        )
        .await
        .unwrap();
        assert!(out.0.get("comments").is_some());
    }

    // ── R2-BE-15: mentions active-only + capped at 20 ────────────────────────

    #[tokio::test]
    async fn mentions_inactive_user_rejected() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let inactive = create_user(&pool, "EMPLOYEE", false).await;
        let tid = create_ticket(&pool, requester).await;

        let err = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req(vec![inactive]),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("inactive"), "message: {}", err.message);

        // Mixed active + inactive is also rejected.
        let active = create_user(&pool, "EMPLOYEE", true).await;
        let err = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req(vec![active, inactive]),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = $1")
            .bind(tid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(0, n);
    }

    #[tokio::test]
    async fn mentions_over_cap_rejected() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let tid = create_ticket(&pool, requester).await;
        let mut ids = Vec::new();
        for _ in 0..21 {
            ids.push(create_user(&pool, "EMPLOYEE", true).await);
        }

        let err = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req(ids),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("20"), "message: {}", err.message);

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = $1")
            .bind(tid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(0, n);
    }

    #[tokio::test]
    async fn mentions_twenty_active_accepted() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let tid = create_ticket(&pool, requester).await;
        let mut ids = Vec::new();
        for _ in 0..20 {
            ids.push(create_user(&pool, "EMPLOYEE", true).await);
        }

        let (code, Json(c)) = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req(ids),
        )
        .await
        .unwrap();
        assert_eq!(code, StatusCode::CREATED);
        assert_eq!(c.ticket_id, tid);
        assert_eq!(20, c.mentions.as_array().map(|a| a.len()).unwrap_or(0));
    }

    #[tokio::test]
    async fn mentions_nonexistent_still_rejected() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_user(&pool, "AGENT", true).await;
        let requester = create_user(&pool, "EMPLOYEE", true).await;
        let tid = create_ticket(&pool, requester).await;

        let err = create_comment(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            UuidPath(tid),
            comment_req(vec![Uuid::new_v4()]),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("do not exist"), "message: {}", err.message);
    }
}
