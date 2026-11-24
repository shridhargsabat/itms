// SLA policy + breach tracking (P1-4, issue #45).
// ONE fixed policy by priority (explicitly NOT a multi-policy engine):
//   URGENT 4h · HIGH 8h · MEDIUM 24h · LOW 72h
// sla_due_at lives on tickets (set at create, recomputed on priority change);
// escalation sweep is a token-gated endpoint the cron hits every 5 min.

use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
    routing::get,
    Router,
};
use chrono::{Duration, Utc};
use serde_json::json;

use crate::db::AppState;
use super::{notifications::notify, AppError};

/// Fixed policy table — hours from creation.
pub fn sla_hours(priority: &str) -> Option<i64> {
    match priority {
        "URGENT" => Some(4),
        "HIGH" => Some(8),
        "MEDIUM" => Some(24),
        "LOW" => Some(72),
        _ => None,
    }
}

pub fn router() -> Router<AppState> {
    // protected (portal auth): policy lookup
    Router::new().route("/policy", get(policy))
}

pub fn escalate_router() -> Router<AppState> {
    // public (token-gated inside): cron sweep
    Router::new().route("/escalate", axum::routing::post(escalate))
}

async fn policy() -> Json<serde_json::Value> {
    Json(json!({
        "URGENT": { "hours": 4, "label": "4 hours" },
        "HIGH": { "hours": 8, "label": "8 hours" },
        "MEDIUM": { "hours": 24, "label": "24 hours" },
        "LOW": { "hours": 72, "label": "72 hours" },
    }))
}

/// Cron sweep: find breached OPEN/IN_PROGRESS tickets that haven't been
/// escalated yet, fire a notification to the assignee (or all agents when
/// unassigned), mark sla_escalated_at. Token-gated like /intake.
async fn escalate(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    // wave-1a: same fail-closed + constant-time gate as /intake.
    let expected = std::env::var("INTAKE_TOKEN").unwrap_or_default();
    super::intake::check_intake_token(&headers, &expected)?;

    // breached + not yet escalated
    let breached: Vec<(uuid::Uuid, String, String, Option<uuid::Uuid>, String)> = sqlx::query_as(
        "SELECT id, ticket_number, title, assignee_id, priority \
         FROM tickets \
         WHERE status IN ('OPEN', 'IN_PROGRESS') \
           AND sla_due_at IS NOT NULL AND sla_due_at < NOW() \
           AND sla_escalated_at IS NULL \
         ORDER BY sla_due_at ASC",
    )
    .fetch_all(pool)
    .await?;

    for (tid, number, title, assignee, priority) in &breached {
        let overdue = Utc::now() - sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
            "SELECT sla_due_at FROM tickets WHERE id = $1",
        )
        .bind(tid)
        .fetch_one(pool)
        .await?;
        let overdue_h = overdue.num_minutes() / 60;

        if let Some(aid) = assignee {
            notify(
                pool,
                *aid,
                "SLA_BREACH",
                &format!("SLA breached: {number}"),
                &format!("{} ({} · overdue by {}h)", title, priority, overdue_h),
                "ticket",
                *tid,
            )
            .await;
        } else {
            // unassigned → escalate to the whole agent team
            let agents: Vec<uuid::Uuid> =
                sqlx::query_scalar("SELECT id FROM users WHERE role = 'AGENT' AND active = TRUE")
                    .fetch_all(pool)
                    .await?;
            for aid in agents {
                notify(
                    pool,
                    aid,
                    "SLA_BREACH",
                    &format!("SLA breached (unassigned): {number}"),
                    &format!("{} ({} · overdue by {}h)", title, priority, overdue_h),
                    "ticket",
                    *tid,
                )
                .await;
            }
        }

        sqlx::query("UPDATE tickets SET sla_escalated_at = NOW() WHERE id = $1")
            .bind(tid)
            .execute(pool)
            .await?;
        crate::audit::write(
            pool,
            None,
            "SLA_ESCALATE",
            "ticket",
            *tid,
            json!({"number": number, "overdue_hours": overdue_h}),
        )
        .await?;
    }

    Ok(Json(json!({ "escalated": breached.len() })))
}

/// Recompute sla_due_at for a ticket (create / priority change). Returns the
/// new due time, or None when the ticket is closed (SLA stops).
pub async fn set_sla_due(
    pool: &sqlx::PgPool,
    ticket_id: uuid::Uuid,
    priority: &str,
    status: &str,
    created_at: chrono::DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let due = match status {
        "OPEN" | "IN_PROGRESS" => Some(created_at + Duration::hours(sla_hours(priority).unwrap_or(24))),
        _ => None,
    };
    sqlx::query("UPDATE tickets SET sla_due_at = $2 WHERE id = $1")
        .bind(ticket_id)
        .bind(due)
        .execute(pool)
        .await?;
    Ok(())
}
