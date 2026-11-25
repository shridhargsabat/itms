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

/// TBE-30: human overdue duration — minutes under an hour ("59m", never the
/// old truncating "overdue by 0h"), hours under a day, days beyond.
pub fn format_overdue(minutes: i64) -> String {
    let minutes = minutes.max(0);
    if minutes < 60 {
        format!("{minutes}m")
    } else if minutes < 60 * 24 {
        format!("{}h", minutes / 60)
    } else {
        format!("{}d", minutes / (60 * 24))
    }
}

/// Cron sweep: find breached OPEN/IN_PROGRESS tickets that haven't been
/// escalated yet, fire a notification to the assignee (or all active
/// AGENTs+ADMINs when unassigned), mark sla_escalated_at. Token-gated like
/// /intake. TBE-30: single query (no N+1) + SKIP LOCKED so overlapping cron
/// runs can't double-notify; TBE-17: ADMINs included, and rows nobody was
/// notified for are left unstamped for the next sweep.
async fn escalate(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    // wave-1a: same fail-closed + constant-time gate as /intake.
    let expected = std::env::var("INTAKE_TOKEN").unwrap_or_default();
    super::intake::check_intake_token(&headers, &expected)?;

    // breached + not yet escalated — locked SKIP LOCKED inside the tx so two
    // concurrent sweeps never notify+stamp the same ticket twice.
    let mut tx = pool.begin().await?;
    let breached: Vec<(uuid::Uuid, String, String, Option<uuid::Uuid>, String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, ticket_number, title, assignee_id, priority, sla_due_at \
             FROM tickets \
             WHERE status IN ('OPEN', 'IN_PROGRESS') \
               AND sla_due_at IS NOT NULL AND sla_due_at < NOW() \
               AND sla_escalated_at IS NULL \
             ORDER BY sla_due_at ASC \
             FOR UPDATE SKIP LOCKED",
        )
        .fetch_all(&mut *tx)
        .await?;

    let mut escalated = 0;
    for (tid, number, title, assignee, priority, due_at) in &breached {
        let overdue_mins = (Utc::now() - *due_at).num_minutes();
        let overdue_label = format_overdue(overdue_mins);
        // overdue_hours kept (floor) for existing consumers; minutes added.
        let overdue_h = overdue_mins.max(0) / 60;
        let overdue_m = overdue_mins.max(0);

        let notified: usize = if let Some(aid) = assignee {
            notify(
                pool,
                *aid,
                "SLA_BREACH",
                &format!("SLA breached: {number}"),
                &format!("{} ({} · overdue by {})", title, priority, overdue_label),
                "ticket",
                *tid,
            )
            .await;
            1
        } else {
            // unassigned → escalate to the whole active staff team (TBE-17:
            // ADMINs included — previously AGENTs only).
            let staff: Vec<uuid::Uuid> = sqlx::query_scalar(
                "SELECT id FROM users WHERE role IN ('AGENT', 'ADMIN') AND active = TRUE",
            )
            .fetch_all(pool)
            .await?;
            for aid in &staff {
                notify(
                    pool,
                    *aid,
                    "SLA_BREACH",
                    &format!("SLA breached (unassigned): {number}"),
                    &format!("{} ({} · overdue by {})", title, priority, overdue_label),
                    "ticket",
                    *tid,
                )
                .await;
            }
            staff.len()
        };

        // TBE-17: stamp + audit ONLY when somebody was actually notified —
        // zero active staff no longer burns the escalation silently.
        if notified == 0 {
            tracing::warn!("sla sweep: {number} breached but no staff to notify — leaving unstamped");
            continue;
        }
        sqlx::query("UPDATE tickets SET sla_escalated_at = NOW() WHERE id = $1")
            .bind(tid)
            .execute(&mut *tx)
            .await?;
        crate::audit::write(
            &mut *tx,
            None,
            "SLA_ESCALATE",
            "ticket",
            *tid,
            json!({"number": number, "overdue_hours": overdue_h, "overdue_minutes": overdue_m}),
        )
        .await?;
        escalated += 1;
    }
    tx.commit().await?;

    Ok(Json(json!({ "escalated": escalated })))
}

/// Recompute sla_due_at for a ticket (create / priority change / reopen).
/// Returns () — the due time is stored on the row; None (NULL) when the
/// ticket is closed (SLA stops).
///
/// `reopened` (TBE-03): CLOSED/RESOLVED → OPEN/IN_PROGRESS restarts the clock
/// from NOW — created_at would mark every reopened old ticket instantly
/// overdue. Whenever the recomputed due lands in the future, a stale
/// sla_escalated_at is cleared so a re-breach can notify again (the sweep
/// only picks up rows with sla_escalated_at IS NULL).
pub async fn set_sla_due<'e, E>(
    executor: E,
    ticket_id: uuid::Uuid,
    priority: &str,
    status: &str,
    created_at: chrono::DateTime<Utc>,
    reopened: bool,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    match status {
        "OPEN" | "IN_PROGRESS" => {
            let base = if reopened { Utc::now() } else { created_at };
            // TBE-31: the 24h fallback is unreachable in practice — creates
            // validate priority (TBE-01) and migration 0026 CHECKs it — but
            // stays as defense-in-depth for pre-constraint rows.
            let due = base + Duration::hours(sla_hours(priority).unwrap_or(24));
            sqlx::query(
                "UPDATE tickets SET sla_due_at = $2, \
                 sla_escalated_at = CASE WHEN $2 > NOW() THEN NULL ELSE sla_escalated_at END \
                 WHERE id = $1",
            )
            .bind(ticket_id)
            .bind(due)
            .execute(executor)
            .await?;
        }
        _ => {
            sqlx::query("UPDATE tickets SET sla_due_at = NULL WHERE id = $1")
                .bind(ticket_id)
                .execute(executor)
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overdue_labels_use_minutes_hours_days() {
        assert_eq!(format_overdue(0), "0m");
        assert_eq!(format_overdue(59), "59m");
        assert_eq!(format_overdue(60), "1h");
        assert_eq!(format_overdue(61), "1h");
        assert_eq!(format_overdue(23 * 60 + 59), "23h");
        assert_eq!(format_overdue(24 * 60), "1d");
        assert_eq!(format_overdue(3 * 24 * 60 + 1), "3d");
        assert_eq!(format_overdue(-5), "0m");
    }

    #[test]
    fn policy_table_matches_documented_hours() {
        assert_eq!(sla_hours("URGENT"), Some(4));
        assert_eq!(sla_hours("HIGH"), Some(8));
        assert_eq!(sla_hours("MEDIUM"), Some(24));
        assert_eq!(sla_hours("LOW"), Some(72));
        assert_eq!(sla_hours("CRITICAL"), None);
    }
}
