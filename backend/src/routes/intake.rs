// Email-to-ticket intake (P1-3, issue #44).
// External cron (itms-email-intake.py) delivers sanitized email payloads here.
// Dedupe by Message-ID (idempotent retries), [INC-xxxx]/[REQ-xxxx] subject
// routing and thread-key linkage turn replies into comments, unknown senders
// auto-create an EMPLOYEE user so they can track the ticket without a portal
// login. Replies from non-participants are quarantined as NEW tickets
// (TBE-15) — never appended to a thread they don't belong to, never dropped.

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

/// Wave-1a: service-token gate shared by /intake and the SLA cron sweep.
/// Fail CLOSED — an empty/unset INTAKE_TOKEN denies everything (503) instead
/// of leaving the endpoint open. Comparison is constant-time (subtle) to
/// block timing probes. `expected` is a parameter (not read from env here)
/// so the predicate is unit-testable without env races.
pub fn check_intake_token(headers: &HeaderMap, expected: &str) -> Result<(), AppError> {
    if expected.is_empty() {
        return Err(AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "intake not configured",
        ));
    }
    let presented = headers
        .get("x-intake-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    use subtle::ConstantTimeEq;
    let ok: bool = presented.as_bytes().ct_eq(expected.as_bytes()).into();
    if !ok {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid intake token"));
    }
    Ok(())
}

/// TBE-15 handler-layer sender allowlist (fail CLOSED).
/// `allowlist_raw` is the raw INTAKE_SENDER_ALLOWLIST env value: comma-separated
/// exact addresses and `@domain` suffix entries (case-insensitive, trimmed).
/// `@domain` matches only that exact domain (no subdomain wildcard).
/// Pure predicate — env is read in the handler so unit tests avoid env races.
/// Comparisons are constant-time (subtle), mirroring check_intake_token: every
/// entry is compared (no early break); length mismatches simply never match.
pub fn is_sender_allowed(from_email: &str, allowlist_raw: &str) -> bool {
    use subtle::ConstantTimeEq;
    let sender = from_email.trim().to_lowercase();
    if sender.is_empty() || !sender.contains('@') {
        return false;
    }
    let sender_domain = sender.rsplit('@').next().unwrap_or("");
    let mut any_rule = false;
    let mut allowed = false;
    for raw_entry in allowlist_raw.split(',') {
        let entry = raw_entry.trim().to_lowercase();
        if entry.is_empty() {
            continue;
        }
        if let Some(domain) = entry.strip_prefix('@') {
            if domain.is_empty() {
                continue;
            }
            any_rule = true;
            let ok: bool = sender_domain.as_bytes().ct_eq(domain.as_bytes()).into();
            allowed |= ok;
        } else {
            if !entry.contains('@') {
                continue;
            }
            any_rule = true;
            let ok: bool = sender.as_bytes().ct_eq(entry.as_bytes()).into();
            allowed |= ok;
        }
    }
    any_rule && allowed
}

/// TBE-15 gate: deny when INTAKE_SENDER_ALLOWLIST is missing/empty (503, fail
/// CLOSED — mirrors check_intake_token) or when the sender is not listed (403).
/// `allowlist_raw` is passed in (not read from env here) so the predicate stays
/// unit-testable without env races.
pub fn check_sender_allowlist(from_email: &str, allowlist_raw: &str) -> Result<(), AppError> {
    let configured = allowlist_raw.split(',').any(|e| {
        let t = e.trim();
        if t.is_empty() {
            return false;
        }
        if let Some(d) = t.strip_prefix('@') {
            !d.trim().is_empty()
        } else {
            t.contains('@')
        }
    });
    if !configured {
        return Err(AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "intake sender allowlist not configured",
        ));
    }
    if !is_sender_allowed(from_email, allowlist_raw) {
        return Err(AppError::new(StatusCode::FORBIDDEN, "sender not allowed"));
    }
    Ok(())
}

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

/// Column mirrors for TBE-10 pre-checks (chars — Postgres VARCHAR counts
/// characters, not bytes).
const MAX_MESSAGE_ID_CHARS: usize = 320;
const MAX_THREAD_KEY_CHARS: usize = 320;
const MAX_FROM_EMAIL_CHARS: usize = 255;
const MAX_FROM_NAME_CHARS: usize = 120;
const MAX_SUBJECT_CHARS: usize = 255;
/// ticket_comments.body CHECK(char_length(body) <= 4000) — replies past this
/// are truncated with a marker (TBE-04), never 500.
const MAX_REPLY_CHARS: usize = 4000;
const MAX_TITLE_CHARS: usize = 255;
/// Auto-created email users get a real masters department (TBE-32: was the
/// free-text 'Unassigned', which exists in no lookup list).
const AUTO_USER_DEPARTMENT: &str = "IT";

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
    // (case-insensitive — "[inc-0123]" is the same ticket).
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let tag = rest[..end].to_uppercase();
            if tag.len() >= 8 && tag.starts_with("INC-") || tag.len() >= 8 && tag.starts_with("REQ-") {
                s = rest[end + 1..].trim().trim_start_matches(':').trim().to_string();
            }
        }
    }
    s
}

/// Scan for an INC-xxxx / REQ-xxxx reference with ANY digit count (live
/// numbers are 5+ digits — never truncate at a fixed window). Case-insensitive
/// (TBE-14: lowercase "[inc-123]" previously spawned a duplicate ticket) and
/// REQ-YYYY-NNNN aware (the naive digit-run scan returned "REQ-2026" for
/// "REQ-2026-0001", which never matches). Returns the reference normalized to
/// uppercase, matching stored ticket/request numbers.
fn extract_ticket_number(subject: &str) -> Option<String> {
    let upper = subject.to_uppercase();
    let chars: Vec<char> = upper.chars().collect();
    // Byte offsets of each char in the UPPERCASED string, so the returned
    // slice is the normalized (uppercase) reference.
    let byte_offsets: Vec<usize> = upper.char_indices().map(|(i, _)| i).collect();
    let mut i = 0;
    while i + 4 <= chars.len() {
        let is_inc = chars[i] == 'I' && chars[i + 1] == 'N' && chars[i + 2] == 'C' && chars[i + 3] == '-';
        let is_req = chars[i] == 'R' && chars[i + 1] == 'E' && chars[i + 2] == 'Q' && chars[i + 3] == '-';
        if !is_inc && !is_req {
            i += 1;
            continue;
        }
        let mut j = i + 4;
        // Consume digits plus internal dashes that are followed by more
        // digits (REQ-2026-0001); a trailing/double dash ends the run.
        loop {
            let digits_start = j;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            if j > digits_start
                && j + 1 < chars.len()
                && chars[j] == '-'
                && chars[j + 1].is_ascii_digit()
            {
                j += 1; // consume the dash, loop consumes the next digit run
                continue;
            }
            break;
        }
        if j > i + 4 {
            let start = byte_offsets[i];
            let end = if j < chars.len() { byte_offsets[j] } else { upper.len() };
            return Some(upper[start..end].to_string());
        }
        i += 1;
    }
    None
}

/// TBE-04: truncate to `max_chars` characters with a visible marker instead
/// of dying on the CHECK constraint (500 + infinite cron retry).
pub fn truncate_with_marker(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let marker = "… [message truncated]";
    let keep = max_chars.saturating_sub(marker.chars().count());
    let mut out: String = s.chars().take(keep).collect();
    out.push_str(marker);
    out
}

/// TBE-10: VARCHAR pre-checks → 422 (never Postgres length-violation 500s).
/// TBE-22: 422, consistent with the rest of the ticket API.
fn validate_intake_lengths(body: &EmailIntakeInput) -> Result<(), AppError> {
    let check = |field: &str, len: usize, max: usize| {
        if len > max {
            Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("{field} exceeds {max} characters"),
            ))
        } else {
            Ok(())
        }
    };
    check("message_id", body.message_id.chars().count(), MAX_MESSAGE_ID_CHARS)?;
    if let Some(tk) = body.thread_key.as_deref() {
        check("thread_key", tk.chars().count(), MAX_THREAD_KEY_CHARS)?;
    }
    check("from_email", body.from_email.trim().chars().count(), MAX_FROM_EMAIL_CHARS)?;
    if let Some(name) = body.from_name.as_deref() {
        check("from_name", name.chars().count(), MAX_FROM_NAME_CHARS)?;
    }
    check("subject", body.subject.chars().count(), MAX_SUBJECT_CHARS)?;
    Ok(())
}

/// Resolve the sender to a user id, auto-creating an EMPLOYEE when unknown.
/// Auto-created users get a USER_CREATE audit row (TBE-08) and a real masters
/// department (TBE-32). Runs inside the caller's transaction.
async fn resolve_or_create_sender(
    conn: &mut sqlx::PgConnection,
    from_email: &str,
    from_name: Option<&str>,
) -> Result<Uuid, AppError> {
    if let Some(uid) = sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = $1")
        .bind(from_email)
        .fetch_optional(&mut *conn)
        .await?
    {
        return Ok(uid);
    }
    let name = from_name
        .filter(|n| !n.trim().is_empty())
        .map(str::trim)
        .unwrap_or_else(|| from_email.split('@').next().unwrap_or("Email User"))
        .to_string();
    let password = format!("ep-{}", Uuid::new_v4().simple());
    let hash = crate::auth::hash_password(&password)
        .map_err(|_| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "password hash failed"))?;
    let created: Uuid = sqlx::query_scalar(
        "INSERT INTO users (name, email, role, department, password_hash) \
         VALUES ($1, $2, 'EMPLOYEE', $3, $4) RETURNING id",
    )
    .bind(&name)
    .bind(from_email)
    .bind(AUTO_USER_DEPARTMENT)
    .bind(&hash)
    .fetch_one(&mut *conn)
    .await?;
    crate::audit::write(
        &mut *conn,
        None,
        "USER_CREATE",
        "user",
        created,
        json!({"email": from_email, "name": name, "role": "EMPLOYEE", "department": AUTO_USER_DEPARTMENT, "source": "email_intake"}),
    )
    .await?;
    tracing::info!("intake: auto-created user {from_email} (id {created})");
    Ok(created)
}

/// Shared new-ticket insert for the intake paths (genuinely-new mail AND
/// quarantined replies): number alloc + ticket + SLA + ingest row + audit.
/// `quarantined_from` carries the cited reference when this ticket is a
/// TBE-15 quarantine (else None). Runs inside the caller's transaction.
#[allow(clippy::too_many_arguments)]
async fn create_intake_ticket(
    conn: &mut sqlx::PgConnection,
    requester: Uuid,
    title: &str,
    description: &str,
    body: &EmailIntakeInput,
    from_email: &str,
    quarantined_from: Option<&str>,
) -> Result<(Uuid, String), AppError> {
    // NOTE: inside the tx, number races use ON CONFLICT DO NOTHING + retry (a
    // unique-violation *error* would poison the whole tx).
    for attempt in 0..10 {
        let next_num: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX((substring(ticket_number FROM '([0-9]+)$'))::bigint), COUNT(*)) + 1 FROM tickets"
        )
        .fetch_one(&mut *conn)
        .await?;
        let ticket_number = format!("INC-{:04}", next_num + attempt as i64);

        let row: Option<crate::models::Ticket> = sqlx::query_as::<_, crate::models::Ticket>(
            "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, \
                source, requester_id, assignee_id, asset_id) \
             VALUES ($1, $2, $3, 'INCIDENT', 'MEDIUM', 'OPEN', 'EMAIL', $4, NULL, NULL) \
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
        .bind(requester)
        .fetch_optional(&mut *conn)
        .await?;

        let Some(ticket) = row else {
            tracing::warn!("intake: ticket number {ticket_number} collided, retrying");
            continue;
        };

        super::sla::set_sla_due(&mut *conn, ticket.id, &ticket.priority, "OPEN", ticket.created_at, false).await?;

        sqlx::query(
            "INSERT INTO email_ingest (message_id, thread_key, ticket_id, from_email, from_name, subject, kind) \
             VALUES ($1, $2, $3, $4, $5, $6, 'TICKET')",
        )
        .bind(&body.message_id)
        .bind(&body.thread_key)
        .bind(ticket.id)
        .bind(from_email)
        .bind(&body.from_name)
        .bind(&body.subject)
        .execute(&mut *conn)
        .await?;

        let mut diff = json!({"message_id": body.message_id, "from": from_email, "number": ticket_number});
        if let Some(q) = quarantined_from {
            diff["quarantined_from"] = json!(q);
            diff["quarantine_reason"] = json!("sender is not a participant of the cited ticket/request");
        }
        crate::audit::write(
            &mut *conn,
            Some(requester),
            "TICKET_EMAIL_INTAKE",
            "ticket",
            ticket.id,
            diff,
        )
        .await?;
        return Ok((ticket.id, ticket_number));
    }
    Err(AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate a unique ticket number",
    ))
}

/// TBE-15: is the sender allowed to append to this ticket? Requester,
/// assignee, or a prior commenter — anyone else is quarantined.
async fn is_ticket_participant(
    conn: &mut sqlx::PgConnection,
    ticket_id: Uuid,
    sender: Uuid,
) -> Result<bool, AppError> {
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tickets \
         WHERE id = $1 AND (requester_id = $2 OR assignee_id = $2)) \
         OR EXISTS(SELECT 1 FROM ticket_comments WHERE ticket_id = $1 AND author_id = $2)",
    )
    .bind(ticket_id)
    .bind(sender)
    .fetch_one(&mut *conn)
    .await?;
    Ok(ok)
}

async fn intake_email(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<EmailIntakeInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    // ── TBE-15 trust boundary ─────────────────────────────────────────────
    // This endpoint authenticates the CRON (shared X-Intake-Token) AND enforces
    // a handler-layer sender allowlist (INTAKE_SENDER_ALLOWLIST, fail CLOSED):
    // the From address below is self-asserted by whoever handed the message to
    // the cron, so any sender missing from the allowlist — or any request when
    // the allowlist is empty/unset — is denied here, after the token gate.
    // The handler receives parsed JSON and CANNOT verify SPF/DKIM crypto itself;
    // spoof-resistance for the sender identity MUST still be enforced by the
    // external intake cron before POSTing here.
    // TODO(cron): verify SPF + DKIM (+DMARC alignment) on every message in the
    // external itms-email-intake.py fetcher (not in this repo); unauthenticated
    // mail must never reach this endpoint. Defense in depth: keep a matching
    // allowlist at the fetcher too. The handler additionally quarantines replies
    // whose sender is not a participant of the cited ticket/request, so a
    // spoofed citation can't pollute other threads.
    // ─────────────────────────────────────────────────────────────────────
    let pool = &state.pool;
    let from_email = body.from_email.trim().to_lowercase();
    if from_email.is_empty() || !from_email.contains('@') {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "from_email is required"));
    }
    validate_intake_lengths(&body)?;

    // service-token gate: the cron must present X-Intake-Token = INTAKE_TOKEN
    // (fail-closed + constant-time — see check_intake_token).
    let expected = std::env::var("INTAKE_TOKEN").unwrap_or_default();
    check_intake_token(&headers, &expected)?;

    // TBE-15 handler-layer sender allowlist (fail CLOSED): the handler cannot
    // verify SPF/DKIM crypto itself (parsed JSON only), so it enforces
    // INTAKE_SENDER_ALLOWLIST here as a second gate after the cron token.
    let allowlist = std::env::var("INTAKE_SENDER_ALLOWLIST").unwrap_or_default();
    check_sender_allowlist(&from_email, &allowlist)?;

    // 1. dedupe by Message-ID — idempotent redelivery is a no-op
    let dup: Option<String> = sqlx::query_scalar("SELECT kind FROM email_ingest WHERE message_id = $1")
        .bind(&body.message_id)
        .fetch_optional(pool)
        .await?;
    if let Some(kind) = dup {
        return Ok(Json(json!({ "duplicate": true, "kind": kind })));
    }

    // 2. reply routing: [INC-xxxx]/[REQ-xxxx] in subject wins, then thread-key
    // linkage. TBE-14: the scan is case-insensitive and REQ- numbers route to
    // service_requests — never silently duplicate as new INCIDENTs.
    let subject_clean = clean_subject(&body.subject);
    let cited = extract_ticket_number(&body.subject);
    let mut target_ticket: Option<Uuid> = None;
    let mut target_request: Option<(Uuid, String, String, Uuid, Option<Uuid>)> = None;
    if let Some(num) = cited.as_deref() {
        if num.starts_with("REQ-") {
            target_request = sqlx::query_as(
                "SELECT id, request_number, status, requester_id, assignee_id \
                 FROM service_requests WHERE UPPER(request_number) = $1",
            )
            .bind(num)
            .fetch_optional(pool)
            .await?;
        } else {
            target_ticket = sqlx::query_scalar("SELECT id FROM tickets WHERE UPPER(ticket_number) = $1")
                .bind(num)
                .fetch_optional(pool)
                .await?;
        }
    }
    if target_ticket.is_none() && target_request.is_none() {
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

    if let Some((request_id, request_number, req_status, req_requester, req_assignee)) = target_request {
        // Reply to a service request → notify its people (service requests
        // have no comment thread; the reply is recorded in email_ingest +
        // audit, never duplicated as an INCIDENT).
        let mut tx = pool.begin().await?;
        let sender = resolve_or_create_sender(&mut tx, &from_email, body.from_name.as_deref()).await?;
        let is_member = sender == req_requester || Some(sender) == req_assignee;
        let terminal = matches!(req_status.as_str(), "COMPLETED" | "REJECTED" | "CANCELLED");
        if !is_member || terminal {
            // TBE-15: spoofed or late reply → quarantine as a new ticket.
            tx.rollback().await?;
            return quarantine_as_new_ticket(pool, &body, &from_email, &subject_clean, &request_number).await;
        }
        sqlx::query(
            "INSERT INTO email_ingest (message_id, thread_key, ticket_id, from_email, from_name, subject, kind) \
             VALUES ($1, $2, NULL, $3, $4, $5, 'REPLY')",
        )
        .bind(&body.message_id)
        .bind(&body.thread_key)
        .bind(&from_email)
        .bind(&body.from_name)
        .bind(&body.subject)
        .execute(&mut *tx)
        .await?;
        crate::audit::write(
            &mut *tx,
            Some(sender),
            "REQUEST_EMAIL_REPLY",
            "service_request",
            request_id,
            json!({
                "message_id": body.message_id,
                "from": from_email,
                "number": request_number,
                "excerpt": body.body.trim().chars().take(500).collect::<String>(),
            }),
        )
        .await?;
        tx.commit().await?;

        // notify requester + assignee (skip the sender)
        for uid in [req_requester].into_iter().chain(req_assignee).filter(|u| *u != sender) {
            notify(
                pool,
                uid,
                "REQUEST_EMAIL_REPLY",
                &format!("New email reply on {request_number}"),
                &format!("{} wrote: {}", from_email, body.body.trim().chars().take(120).collect::<String>()),
                "service_request",
                request_id,
            )
            .await;
        }
        return Ok(Json(json!({ "kind": "request_reply", "request_id": request_id, "request_number": request_number })));
    }

    if let Some(ticket_id) = target_ticket {
        // reply → append comment on the linked ticket (attributed to the sender).
        // Atomic: sender user + comment + ingest row + audit, or nothing.
        let mut tx = pool.begin().await?;
        let sender = resolve_or_create_sender(&mut tx, &from_email, body.from_name.as_deref()).await?;
        let ticket_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM tickets WHERE id = $1")
                .bind(ticket_id)
                .fetch_optional(&mut *tx)
                .await?;
        let closed = ticket_status.as_deref() == Some("CLOSED");
        // TBE-15: link the reply ONLY if the sender is the requester, the
        // assignee, or a prior commenter — and the ticket isn't CLOSED
        // (portal parity with TBE-05). Anything else quarantines.
        if closed || !is_ticket_participant(&mut tx, ticket_id, sender).await? {
            tx.rollback().await?;
            let cited_ref = cited.clone().unwrap_or_else(|| format!("thread:{:?}", body.thread_key));
            return quarantine_as_new_ticket(pool, &body, &from_email, &subject_clean, &cited_ref).await;
        }
        // TBE-04: truncate past the 4000-char CHECK with a marker (was: 500
        // + infinite cron retry). TBE-21: store trimmed.
        let reply_body = truncate_with_marker(body.body.trim(), MAX_REPLY_CHARS);
        let comment = sqlx::query_as::<_, crate::models::TicketComment>(
            "INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES ($1, $2, $3) \
             RETURNING id, ticket_id, author_id, body, mentions, created_at",
        )
        .bind(ticket_id)
        .bind(sender)
        .bind(&reply_body)
        .fetch_one(&mut *tx)
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
        .execute(&mut *tx)
        .await?;

        crate::audit::write(
            &mut *tx,
            Some(sender),
            "TICKET_EMAIL_REPLY",
            "ticket",
            ticket_id,
            json!({"message_id": body.message_id, "from": from_email}),
        )
        .await?;
        tx.commit().await?;

        // notify participants — portal parity (TBE-32): requester + assignee
        // + prior commenters, skip the sender.
        let participants: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT user_id FROM (
                SELECT requester_id AS user_id FROM tickets WHERE id = $1
                UNION SELECT assignee_id FROM tickets WHERE id = $1 AND assignee_id IS NOT NULL
                UNION SELECT author_id FROM ticket_comments WHERE ticket_id = $1
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

    // 3. new ticket — sender must map to a user (auto-create EMPLOYEE if unknown).
    // Atomic: requester user + ticket + SLA + ingest row + audit, or nothing.
    let mut tx = pool.begin().await?;
    let requester = resolve_or_create_sender(&mut tx, &from_email, body.from_name.as_deref()).await?;

    let title = if subject_clean.is_empty() { "Email request".to_string() } else { subject_clean };
    let (ticket_id, ticket_number) =
        create_intake_ticket(&mut tx, requester, &title, body.body.trim(), &body, &from_email, None).await?;
    tx.commit().await?;

    Ok(Json(json!({ "kind": "ticket", "ticket_id": ticket_id, "ticket_number": ticket_number })))
}

/// TBE-15 quarantine: a reply that may not be linked (sender isn't a
/// participant, or the target is closed/terminal) becomes a NEW ticket so the
/// content is triaged instead of polluting other threads or being dropped.
async fn quarantine_as_new_ticket(
    pool: &sqlx::PgPool,
    body: &EmailIntakeInput,
    from_email: &str,
    subject_clean: &str,
    cited_ref: &str,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = pool.begin().await?;
    let requester = resolve_or_create_sender(&mut tx, from_email, body.from_name.as_deref()).await?;
    let base_title = if subject_clean.is_empty() { "Email request".to_string() } else { subject_clean.to_string() };
    let full_title = format!("[Quarantined reply to {cited_ref}] {base_title}");
    let title: String = full_title.chars().take(MAX_TITLE_CHARS).collect();
    let (ticket_id, ticket_number) =
        create_intake_ticket(&mut tx, requester, &title, body.body.trim(), body, from_email, Some(cited_ref)).await?;
    tx.commit().await?;
    tracing::info!("intake: quarantined reply citing {cited_ref} as {ticket_number}");
    Ok(Json(json!({
        "kind": "ticket",
        "ticket_id": ticket_id,
        "ticket_number": ticket_number,
        "quarantined_from": cited_ref,
    })))
}

#[cfg(test)]
mod wave1a_tests {
    use super::*;

    fn headers_with_token(tok: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-intake-token", tok.parse().unwrap());
        h
    }

    #[test]
    fn fails_closed_when_token_unconfigured() {
        // empty expected denies even a matching (empty) presented token
        let err = check_intake_token(&HeaderMap::new(), "").unwrap_err();
        assert_eq!(err.status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn rejects_wrong_and_missing_tokens() {
        let err = check_intake_token(&HeaderMap::new(), "s3cret").unwrap_err();
        assert_eq!(err.status, StatusCode::UNAUTHORIZED);
        let h = headers_with_token("wrong");
        let err = check_intake_token(&h, "s3cret").unwrap_err();
        assert_eq!(err.status, StatusCode::UNAUTHORIZED);
        // same-length mismatch must also fail (not just length check)
        let h = headers_with_token("s3creu");
        let err = check_intake_token(&h, "s3cret").unwrap_err();
        assert_eq!(err.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn accepts_exact_token() {
        let h = headers_with_token("s3cret-token-value");
        assert!(check_intake_token(&h, "s3cret-token-value").is_ok());
    }
}

#[cfg(test)]
mod tickets_audit_tests {
    use super::*;

    #[test]
    fn ref_scan_is_case_insensitive_and_req_aware() {
        assert_eq!(extract_ticket_number("Re: [INC-0042] printer down").as_deref(), Some("INC-0042"));
        assert_eq!(extract_ticket_number("re: [inc-123] slow pc").as_deref(), Some("INC-123"));
        assert_eq!(
            extract_ticket_number("Re: [REQ-2026-0007] laptop").as_deref(),
            Some("REQ-2026-0007")
        );
        assert_eq!(extract_ticket_number("req-1 quick q").as_deref(), Some("REQ-1"));
        assert_eq!(extract_ticket_number("no reference here"), None);
        assert_eq!(extract_ticket_number("INC- without digits"), None);
        // trailing dash is not part of the reference
        assert_eq!(extract_ticket_number("[INC-42-] x").as_deref(), Some("INC-42"));
    }

    #[test]
    fn clean_subject_strips_lowercase_tags() {
        assert_eq!(clean_subject("[inc-0042] printer down"), "printer down");
        assert_eq!(clean_subject("Re: [REQ-2026-1] hi"), "hi");
        assert_eq!(clean_subject("plain subject"), "plain subject");
    }

    #[test]
    fn truncate_marks_and_fits() {
        assert_eq!(truncate_with_marker("short", 4000), "short");
        let exact = "x".repeat(4000);
        assert_eq!(truncate_with_marker(&exact, 4000).len(), 4000);
        let long = "y".repeat(5000);
        let out = truncate_with_marker(&long, 4000);
        assert_eq!(out.chars().count(), 4000);
        assert!(out.ends_with("… [message truncated]"));
    }

    fn intake_input(subject: &str, from_email: &str) -> EmailIntakeInput {
        EmailIntakeInput {
            message_id: "m1".into(),
            thread_key: None,
            from_email: from_email.into(),
            from_name: None,
            subject: subject.into(),
            body: "b".into(),
        }
    }

    #[test]
    fn length_prechecks_reject_overlong_fields() {
        assert!(validate_intake_lengths(&intake_input("ok", "a@b.c")).is_ok());
        let long_subject = "s".repeat(256);
        let err = validate_intake_lengths(&intake_input(&long_subject, "a@b.c")).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        let long_email = format!("{}@b.c", "a".repeat(300));
        let err = validate_intake_lengths(&intake_input("ok", &long_email)).unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        let mut bad = intake_input("ok", "a@b.c");
        bad.message_id = "m".repeat(321);
        assert_eq!(
            validate_intake_lengths(&bad).unwrap_err().status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut bad = intake_input("ok", "a@b.c");
        bad.from_name = Some("n".repeat(121));
        assert_eq!(
            validate_intake_lengths(&bad).unwrap_err().status,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}

#[cfg(test)]
mod sender_allowlist_tests {
    use super::*;

    #[test]
    fn exact_match_allows_listed_sender() {
        assert!(is_sender_allowed("alice@example.com", "alice@example.com"));
        assert!(is_sender_allowed(
            "alice@example.com",
            "bob@corp.example,alice@example.com,@other.org"
        ));
        assert!(!is_sender_allowed("eve@example.com", "alice@example.com"));
        assert!(check_sender_allowlist("alice@example.com", "alice@example.com").is_ok());
        let err = check_sender_allowlist("eve@example.com", "alice@example.com").unwrap_err();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn at_domain_match_allows_exact_domain_only() {
        assert!(is_sender_allowed("bob@trusted.com", "@trusted.com"));
        assert!(is_sender_allowed(
            "bob@trusted.com",
            "alice@example.com, @trusted.com"
        ));
        assert!(!is_sender_allowed("bob@other.com", "@trusted.com"));
        // no subdomain wildcard: sub.trusted.com is NOT covered by @trusted.com
        assert!(!is_sender_allowed("bob@sub.trusted.com", "@trusted.com"));
        assert!(check_sender_allowlist("bob@trusted.com", "@trusted.com").is_ok());
    }

    #[test]
    fn matching_is_case_insensitive() {
        assert!(is_sender_allowed("ALICE@EXAMPLE.COM", "alice@example.com"));
        assert!(is_sender_allowed("alice@example.com", "ALICE@EXAMPLE.COM"));
        assert!(is_sender_allowed("Bob@Trusted.COM", "@TRUSTED.com"));
        assert!(is_sender_allowed("BOB@TRUSTED.COM", "@trusted.COM"));
    }

    #[test]
    fn denies_when_allowlist_missing_or_empty() {
        // missing / empty / whitespace-only / commas-only / bare-@ → 503 closed
        for raw in ["", "   ", " , , ", "@", "  @  ", "not-an-email", " , bogus , "] {
            assert!(!is_sender_allowed("alice@example.com", raw), "raw={raw:?}");
            let err = check_sender_allowlist("alice@example.com", raw).unwrap_err();
            assert_eq!(err.status, StatusCode::SERVICE_UNAVAILABLE, "raw={raw:?}");
        }
        // empty sender never opens, even with a valid allowlist
        assert!(!is_sender_allowed("", "alice@example.com"));
        assert!(!is_sender_allowed("   ", "@example.com"));
    }

    #[test]
    fn whitespace_around_entries_is_ignored() {
        assert!(is_sender_allowed(
            "  alice@example.com  ",
            "  alice@example.com ,  @example.org  "
        ));
        assert!(is_sender_allowed(
            "bob@example.org",
            "alice@example.com,   @example.org   "
        ));
        assert!(is_sender_allowed(
            "alice@example.com",
            ",, alice@example.com ,,"
        ));
        assert!(!is_sender_allowed("eve@example.com", "  alice@example.com , @example.org "));
    }
}
