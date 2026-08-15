// Ticket comments + activity timeline + attachments (P1-1, issue #42).
// Comment thread with optional mentions, attachments stored on the uploads
// volume (10 MB per-file cap), who-changed-what timeline served from the
// existing audit_logs table.

use std::path::PathBuf;

use axum::{
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::write,
    db::AppState,
    models::{CreateCommentRequest, TicketAttachment, TicketComment},
};
use super::AppError;

const MAX_ATTACHMENT_BYTES: i64 = 10 * 1024 * 1024; // 10 MB

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{ticket_id}/comments", get(list_comments).post(create_comment))
        .route("/{ticket_id}/comments/{comment_id}", delete(delete_comment))
        .route("/{ticket_id}/attachments", post(upload_attachment))
        .route("/{ticket_id}/attachments/{attachment_id}", delete(delete_attachment))
        .route("/{ticket_id}/timeline", get(ticket_timeline))
        .layer(DefaultBodyLimit::max(MAX_ATTACHMENT_BYTES as usize + 1024 * 1024))
}

async fn ensure_ticket(pool: &sqlx::PgPool, ticket_id: Uuid) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as::<_, (String,)>(
        "SELECT title FROM tickets WHERE id = $1",
    )
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

// ── comments ────────────────────────────────────────────────────────────────

async fn list_comments(
    State(state): State<AppState>,
    Path(ticket_id): Path<Uuid>,
) -> Result<Json<Vec<TicketComment>>, AppError> {
    let pool = &state.pool;
    if ensure_ticket(pool, ticket_id).await?.is_none() {
        return Err(AppError::not_found("ticket not found"));
    }
    let rows = sqlx::query_as::<_, TicketComment>(
        "SELECT c.id, c.ticket_id, c.author_id, c.body, c.mentions, c.created_at, \
                u.name AS author_name, u.role AS author_role \
         FROM ticket_comments c JOIN users u ON u.id = c.author_id \
         WHERE c.ticket_id = $1 ORDER BY c.created_at ASC",
    )
    .bind(ticket_id)
    .fetch_all(pool)
    .await?;
    Ok(Json(rows))
}

async fn create_comment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(ticket_id): Path<Uuid>,
    Json(body): Json<CreateCommentRequest>,
) -> Result<(StatusCode, Json<TicketComment>), AppError> {
    let pool = &state.pool;
    let subject = ensure_ticket(pool, ticket_id).await?;
    let Some(subject) = subject else {
        return Err(AppError::not_found("ticket not found"));
    };
    let body_text = body.body.trim();
    if body_text.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "comment body is required"));
    }
    if body_text.chars().count() > 4000 {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "comment exceeds 4000 chars"));
    }
    // mentions must reference existing users
    let mentions_json = if body.mentions.is_empty() {
        json!([])
    } else {
        let found: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE id = ANY($1::uuid[])",
        )
        .bind(&body.mentions)
        .fetch_one(pool)
        .await?;
        if found as usize != body.mentions.len() {
            return Err(AppError::new(StatusCode::BAD_REQUEST, "one or more mentioned users do not exist"));
        }
        json!(body.mentions.iter().map(|u| u.to_string()).collect::<Vec<_>>())
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
    .await?;

    write(
        pool,
        Some(actor_id),
        "TICKET_COMMENT",
        "ticket",
        ticket_id,
        json!({"subject": subject, "comment": comment.id.to_string(), "mentions": body.mentions.len()}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(comment)))
}

async fn delete_comment(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path((ticket_id, comment_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    let row: Option<(String, String, Uuid,)> = sqlx::query_as::<_, (String, String, Uuid)>(
        "SELECT c.body, t.title, c.author_id FROM ticket_comments c \
         JOIN tickets t ON t.id = c.ticket_id WHERE c.id = $1 AND c.ticket_id = $2",
    )
    .bind(comment_id)
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    let Some((body, subject, author)) = row else {
        return Err(AppError::not_found("comment not found"));
    };
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if author != actor_id && role != "ADMIN" {
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
    Path(ticket_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<TicketAttachment>), AppError> {
    let pool = &state.pool;
    let subject = ensure_ticket(pool, ticket_id).await?;
    let Some(subject) = subject else {
        return Err(AppError::not_found("ticket not found"));
    };
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
    Path((ticket_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    let row: Option<(String, String, String, Uuid,)> = sqlx::query_as::<_, (String, String, String, Uuid)>(
        "SELECT a.file_name, a.storage_key, t.title, a.uploader_id FROM ticket_attachments a \
         JOIN tickets t ON t.id = a.ticket_id WHERE a.id = $1 AND a.ticket_id = $2",
    )
    .bind(attachment_id)
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    let Some((file_name, storage_key, subject, uploader)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(actor_id)
        .fetch_one(pool)
        .await?;
    if uploader != actor_id && role != "ADMIN" {
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
pub async fn download_attachment(
    State(state): State<AppState>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let pool = &state.pool;
    let row: Option<(String, String, Option<String>, i64,)> = sqlx::query_as::<_, (String, String, Option<String>, i64)>(
        "SELECT file_name, storage_key, content_type, size_bytes FROM ticket_attachments WHERE id = $1",
    )
    .bind(attachment_id)
    .fetch_optional(pool)
    .await?;
    let Some((file_name, storage_key, content_type, size)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    let dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/uploads".to_string());
    let abs = PathBuf::from(&dir).join(&storage_key);
    let bytes = tokio::fs::read(&abs).await.map_err(|_| {
        AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "stored file missing on disk")
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        content_type.unwrap_or_else(|| "application/octet-stream".to_string()).parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name.replace('"', "_")).parse().unwrap(),
    );
    headers.insert(header::CONTENT_LENGTH, size.to_string().parse().unwrap());
    Ok((headers, bytes).into_response())
}

// ── timeline (comments ∪ audit changes) ─────────────────────────────────────

async fn ticket_timeline(
    State(state): State<AppState>,
    Path(ticket_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    if ensure_ticket(pool, ticket_id).await?.is_none() {
        return Err(AppError::not_found("ticket not found"));
    }
    let comments: Vec<TicketComment> = sqlx::query_as::<_, TicketComment>(
        "SELECT c.id, c.ticket_id, c.author_id, c.body, c.mentions, c.created_at, \
                u.name AS author_name, u.role AS author_role \
         FROM ticket_comments c JOIN users u ON u.id = c.author_id \
         WHERE c.ticket_id = $1 ORDER BY c.created_at ASC",
    )
    .bind(ticket_id)
    .fetch_all(pool)
    .await?;
    // who-changed-what: audit entries for this ticket (TICKET_* actions)
    let changes: Vec<serde_json::Value> = sqlx::query_as::<_, (String, String, chrono::DateTime<chrono::Utc>, serde_json::Value)>(
        "SELECT u.name, al.action, al.created_at, COALESCE(al.diff, '{}'::jsonb) \
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id \
         WHERE al.target_type = 'ticket' AND al.target_id = $1 AND al.action LIKE 'TICKET_%' \
         ORDER BY al.created_at ASC",
    )
    .bind(ticket_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(name, action, at, details)| {
        json!({
            "kind": "change",
            "actor": name,
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
             WHERE a.ticket_id = $1 ORDER BY a.created_at ASC",
        )
        .bind(ticket_id)
        .fetch_all(pool)
        .await?,
    })))
}
