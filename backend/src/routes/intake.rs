// Email-to-ticket intake (P1-3, issue #44).
// External cron (itms-email-intake.py) delivers sanitized email payloads here.
// Dedupe by Message-ID (idempotent retries), [INC-xxxx] subject routing and
// thread-key linkage turn replies into comments, unknown senders auto-create
// an EMPLOYEE user so they can track the ticket without a portal login.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::post,
    Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db::AppState;
use super::{notifications::notify, AppError};

pub fn router() -> Router<AppState> {
    Router::new().route("/email", post(intake_email))
}

#[derive(Debug, Deserialize)]
pub struct EmailIntakeInput {
    pub message_id: String,
    pub thread_key: Option<String>,
    pub from_email: String,
    pub from_name: Option<String>,
    pub subject: String,
    pub body: String,
}

fn clean_subject(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    // strip reply prefixes ("Re:", "RE:", "re:", "Fwd:" etc.)
    loop {
        let parts: Vec<&str> = s.splitn(2, ':').collect();
        let head = parts[0].trim().to_uppercase();
        if parts.len() == 2 && ["RE", "RE ", "FW", "FWD", "R"] .contains(&head.as_str()) {
            s = parts[1].trim().to_string();
        } else {
            break;
        }
    }
    // drop bracketed ticket number prefix: "[INC-0123] actual title"
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let tag = &rest[..end];
            if tag.len() >= 8 && tag.starts_with("INC-") || tag.len() >= 8 && tag.starts_with("REQ-") {
                s = rest[end + 1..].trim().trim_start_matches(':').trim().to_string();
            }
        }
    }
    s
}

fn extract_ticket_number(subject: &str) -> Option<String> {
    // scan for INC-XXXX / REQ-XXXX with ANY digit count (live numbers are
    // 5+ digits — never truncate at a fixed window)
    let chars: Vec<char> = subject.chars().collect();
    for (i, _) in chars.iter().enumerate() {
        let is_inc = i + 4 <= chars.len() && chars[i] == 'I' && chars[i + 1] == 'N' && chars[i + 2] == 'C' && chars[i + 3] == '-';
        let is_req = i + 4 <= chars.len() && chars[i] == 'R' && chars[i + 1] == 'E' && chars[i + 2] == 'Q' && chars[i + 3] == '-';
        if !is_inc && !is_req {
            continue;
        }
        let mut j = i + 4;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        if j > i + 4 {
            return Some(subject[i..j].to_string());
        }
    }
    None
}

async fn intake_email(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<EmailIntakeInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let from_email = body.from_email.trim().to_lowercase();
    if from_email.is_empty() || !from_email.contains('@') {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "from_email is required"));
    }

    // service-token gate: the cron must present X-Intake-Token = INTAKE_TOKEN
    let expected = std::env::var("INTAKE_TOKEN").unwrap_or_default();
    if !expected.is_empty() {
        let presented = headers
            .get("x-intake-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if presented != expected {
            return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid intake token"));
        }
    }

    // 1. dedupe by Message-ID — idempotent redelivery is a no-op
    let dup: Option<String> = sqlx::query_scalar("SELECT kind FROM email_ingest WHERE message_id = $1")
        .bind(&body.message_id)
        .fetch_optional(pool)
        .await?;
    if let Some(kind) = dup {
        return Ok(Json(json!({ "duplicate": true, "kind": kind })));
    }

    // 2. reply routing: [INC-xxxx] in subject wins, then thread-key linkage
    let subject_clean = clean_subject(&body.subject);
    let mut target_ticket: Option<Uuid> = None;
    if let Some(num) = extract_ticket_number(&body.subject) {
        target_ticket = sqlx::query_scalar("SELECT id FROM tickets WHERE ticket_number = $1")
            .bind(&num)
            .fetch_optional(pool)
            .await?;
    }
    if target_ticket.is_none() {
        if let Some(tk) = &body.thread_key {
            target_ticket = sqlx::query_scalar(
                "SELECT ticket_id FROM email_ingest \
                 WHERE thread_key = $1 AND ticket_id IS NOT NULL ORDER BY received_at DESC LIMIT 1",
            )
            .bind(tk)
            .fetch_optional(pool)
            .await?;
        }
    }

    if let Some(ticket_id) = target_ticket {
        // reply → append comment on the linked ticket (attributed to the sender)
        let sender: Uuid = if let Some(uid) =
            sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = $1")
                .bind(&from_email)
                .fetch_optional(pool)
                .await?
        {
            uid
        } else {
            let name = body
                .from_name
                .clone()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| from_email.split('@').next().unwrap_or("Email User").to_string());
            let password = format!("ep-{}", Uuid::new_v4().simple());
            let hash = crate::auth::hash_password(&password)
                .map_err(|_| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "password hash failed"))?;
            sqlx::query_scalar(
                "INSERT INTO users (name, email, role, department, password_hash) \
                 VALUES ($1, $2, 'EMPLOYEE', 'Unassigned', $3) RETURNING id",
            )
            .bind(&name)
            .bind(&from_email)
            .bind(&hash)
            .fetch_one(pool)
            .await?
        };
        let comment = sqlx::query_as::<_, crate::models::TicketComment>(
            "INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES ($1, $2, $3) \
             RETURNING id, ticket_id, author_id, body, mentions, created_at",
        )
        .bind(ticket_id)
        .bind(sender)
        .bind(body.body.trim())
        .fetch_one(pool)
        .await?;

        sqlx::query(
            "INSERT INTO email_ingest (message_id, thread_key, ticket_id, from_email, from_name, subject, kind) \
             VALUES ($1, $2, $3, $4, $5, $6, 'REPLY')",
        )
        .bind(&body.message_id)
        .bind(&body.thread_key)
        .bind(ticket_id)
        .bind(&from_email)
        .bind(&body.from_name)
        .bind(&body.subject)
        .execute(pool)
        .await?;

        crate::audit::write(
            pool,
            Some(sender),
            "TICKET_EMAIL_REPLY",
            "ticket",
            ticket_id,
            json!({"message_id": body.message_id, "from": from_email}),
        )
        .await?;

        // notify participants (requester + assignee, skip system author)
        let participants: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT user_id FROM (
                SELECT requester_id AS user_id FROM tickets WHERE id = $1
                UNION SELECT assignee_id FROM tickets WHERE id = $1 AND assignee_id IS NOT NULL
             ) p WHERE user_id IS NOT NULL AND user_id <> $2",
        )
        .bind(ticket_id)
        .bind(sender)
        .fetch_all(pool)
        .await?;
        for uid in participants {
            notify(
                pool,
                uid,
                "TICKET_COMMENT",
                "New email reply on your ticket",
                &format!("{} wrote: {}", from_email, body.body.trim().chars().take(120).collect::<String>()),
                "ticket",
                ticket_id,
            )
            .await;
        }

        return Ok(Json(json!({ "kind": "reply", "ticket_id": ticket_id, "comment_id": comment.id })));
    }

    // 3. new ticket — sender must map to a user (auto-create EMPLOYEE if unknown)
    let requester: Uuid = if let Some(uid) =
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = $1")
            .bind(&from_email)
            .fetch_optional(pool)
            .await?
    {
        uid
    } else {
        let name = body
            .from_name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| from_email.split('@').next().unwrap_or("Email User").to_string());
        let password = format!("ep-{}", Uuid::new_v4().simple());
        let hash = crate::auth::hash_password(&password)
            .map_err(|_| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "password hash failed"))?;
        let created: Uuid = sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash) \
             VALUES ($1, $2, 'EMPLOYEE', 'Unassigned', $3) RETURNING id",
        )
        .bind(&name)
        .bind(&from_email)
        .bind(&hash)
        .fetch_one(pool)
        .await?;
        tracing::info!("intake: auto-created user {from_email} (id {created})");
        created
    };

    let title = if subject_clean.is_empty() { "Email request".to_string() } else { subject_clean };

    let mut ticket_opt: Option<crate::models::Ticket> = None;
    let mut ticket_number = String::new();
    for attempt in 0..10 {
        let next_num: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX((substring(ticket_number FROM '([0-9]+)$'))::bigint), COUNT(*)) + 1 FROM tickets"
        )
        .fetch_one(pool)
        .await?;
        ticket_number = format!("INC-{:04}", next_num + attempt as i64);

        let result = sqlx::query_as::<_, crate::models::Ticket>(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, \
                source, requester_id, assignee_id, asset_id) \
             VALUES ($1, $2, $3, 'INCIDENT', 'MEDIUM', 'OPEN', 'EMAIL', $4, NULL, NULL) \
             RETURNING id, ticket_number, title, description, ticket_type, priority, status, source, \
                requester_id, assignee_id, asset_id, created_at, updated_at, \
                NULL::text AS requester_name, NULL::text AS assignee_name, \
                NULL::text AS asset_tag, NULL::text AS asset_name",
        )
        .bind(&ticket_number)
        .bind(&title)
        .bind(&body.body)
        .bind(requester)
        .fetch_one(pool)
        .await;

        match result {
            Ok(t) => {
                ticket_opt = Some(t);
                break;
            }
            Err(sqlx::Error::Database(db_err))
                if db_err.is_unique_violation()
                    && db_err.constraint() == Some("tickets_ticket_number_key")
                    && attempt < 9 =>
            {
                tracing::warn!("intake: ticket number {ticket_number} collided, retrying");
                continue;
            }
            Err(err) => return Err(err.into()),
        }
    }
    let ticket = ticket_opt.ok_or_else(|| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not allocate a unique ticket number",
        )
    })?;

    super::sla::set_sla_due(pool, ticket.id, &ticket.priority, "OPEN", ticket.created_at).await?;

    sqlx::query(
        "INSERT INTO email_ingest (message_id, thread_key, ticket_id, from_email, from_name, subject, kind) \
         VALUES ($1, $2, $3, $4, $5, $6, 'TICKET')",
    )
    .bind(&body.message_id)
    .bind(&body.thread_key)
    .bind(ticket.id)
    .bind(&from_email)
    .bind(&body.from_name)
    .bind(&body.subject)
    .execute(pool)
    .await?;

    crate::audit::write(
        pool,
        Some(requester),
        "TICKET_EMAIL_INTAKE",
        "ticket",
        ticket.id,
        json!({"message_id": body.message_id, "from": from_email, "number": ticket_number}),
    )
    .await?;

    Ok(Json(json!({ "kind": "ticket", "ticket_id": ticket.id, "ticket_number": ticket_number })))
}
