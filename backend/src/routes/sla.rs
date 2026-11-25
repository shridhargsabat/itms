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
/// #137 R2-BE-04: an inactive/missing assignee falls through to the staff
/// team instead of burning the escalation on a dead inbox. #138 R2-BE-05:
/// LIMIT 200 oldest-first per run + notices go out post-commit so they are
/// durable-consistent with their stamps.
async fn escalate(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    // wave-1a: same fail-closed + constant-time gate as /intake.
    let expected = std::env::var("INTAKE_TOKEN").unwrap_or_default();
    super::intake::check_intake_token(&headers, &expected)?;

    // Phase 1 (in-tx): lock one batch, resolve recipients, stamp + audit.
    // #138: LIMIT 200 oldest-first so an unbounded backlog can't wedge a
    // single sweep (or the cron slot); SKIP LOCKED kept so overlapping
    // runs still never stamp the same ticket twice.
    type BreachedRow = (uuid::Uuid, String, String, Option<uuid::Uuid>, String, chrono::DateTime<chrono::Utc>);
    let mut tx = pool.begin().await?;
    let breached: Vec<BreachedRow> =
        sqlx::query_as(
            "SELECT id, ticket_number, title, assignee_id, priority, sla_due_at \
             FROM tickets \
             WHERE status IN ('OPEN', 'IN_PROGRESS') \
               AND sla_due_at IS NOT NULL AND sla_due_at < NOW() \
               AND sla_escalated_at IS NULL \
             ORDER BY sla_due_at ASC \
             LIMIT 200 \
             FOR UPDATE SKIP LOCKED",
        )
        .fetch_all(&mut *tx)
        .await?;

    // Stamped rows awaiting their post-commit notices.
    struct PendingNotice {
        tid: uuid::Uuid,
        number: String,
        title: String,
        priority: String,
        overdue_label: String,
        recipients: Vec<uuid::Uuid>,
        unassigned: bool,
    }
    let mut pending: Vec<PendingNotice> = Vec::new();

    for (tid, number, title, assignee, priority, due_at) in &breached {
        let overdue_mins = (Utc::now() - *due_at).num_minutes();
        let overdue_label = format_overdue(overdue_mins);
        // overdue_hours kept (floor) for existing consumers; minutes added.
        let overdue_h = overdue_mins.max(0) / 60;
        let overdue_m = overdue_mins.max(0);

        // #137: only an ACTIVE assignee is notified directly — an
        // inactive/missing assignee falls through to the staff-team branch
        // (previously the assigned branch notified whoever was set and
        // hardcoded notified = 1, burning the escalation on a dead inbox).
        let direct: Option<uuid::Uuid> = match assignee {
            Some(aid) => {
                let active: Option<bool> =
                    sqlx::query_scalar("SELECT active FROM users WHERE id = $1")
                        .bind(aid)
                        .fetch_optional(&mut *tx)
                        .await?;
                if active == Some(true) { Some(*aid) } else { None }
            }
            None => None,
        };
        let (recipients, unassigned): (Vec<uuid::Uuid>, bool) = match direct {
            Some(aid) => (vec![aid], false),
            None => {
                // unassigned, inactive, or missing assignee → the whole
                // active staff team (TBE-17: ADMINs included — previously
                // AGENTs only).
                let staff: Vec<uuid::Uuid> = sqlx::query_scalar(
                    "SELECT id FROM users WHERE role IN ('AGENT', 'ADMIN') AND active = TRUE",
                )
                .fetch_all(&mut *tx)
                .await?;
                (staff, true)
            }
        };

        // TBE-17: stamp + audit ONLY when somebody was actually notified —
        // zero active staff no longer burns the escalation silently.
        if recipients.is_empty() {
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
        pending.push(PendingNotice {
            tid: *tid,
            number: number.clone(),
            title: title.clone(),
            priority: priority.clone(),
            overdue_label,
            recipients,
            unassigned,
        });
    }
    tx.commit().await?;

    // Phase 2 (post-commit): notices go out only for committed stamps —
    // #138 durable-consistency (same pattern as tickets.rs: commit first,
    // then notify). A failed sweep can no longer leave notices durable
    // without their stamps, which the next sweep would then duplicate.
    let mut escalated = 0;
    for p in &pending {
        let subject = if p.unassigned {
            format!("SLA breached (unassigned): {}", p.number)
        } else {
            format!("SLA breached: {}", p.number)
        };
        let body = format!("{} ({} · overdue by {})", p.title, p.priority, p.overdue_label);
        for aid in &p.recipients {
            notify(pool, *aid, "SLA_BREACH", &subject, &body, "ticket", p.tid).await;
        }
        escalated += 1;
    }

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

/// R2 P2 regression tests (issues #137 R2-BE-04, #138 R2-BE-05): inactive
/// assignees fall back to staff, the sweep batches at 200 oldest-first, and
/// every stamp has its notice. Same TEST_DATABASE_URL-with-skip pattern as
/// intake's r2_regression_tests. Sweep tests serialize on SWEEP_LOCK — the
/// sweep is global, so parallel sweeps would stamp each other's tickets and
/// flake count assertions. All assertions are scoped to per-run-unique
/// tickets/users so reruns and sibling suites can't interfere.
#[cfg(test)]
mod r2_p2_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use std::sync::OnceLock;

    const TEST_TOKEN: &str = "r2-intake-test-token";
    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test@127.0.0.1:55434/itms_test";
    /// Cross-process sweep serialization: concurrent `cargo test` runs share
    /// this DB, and the in-process SWEEP_LOCK can't stop another process's
    /// sweep from stealing this test's batch (SKIP LOCKED splits it).
    /// Transaction-scoped → auto-released on commit/rollback, so a panicking
    /// test can't leak it and deadlock later runs.
    const SWEEP_ADVISORY_KEY: i64 = 2026112501;

    static SWEEP_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    fn sweep_lock() -> &'static tokio::sync::Mutex<()> {
        SWEEP_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    /// Hold the global sweep lock for the whole test body (in-process mutex
    /// plus a cross-process advisory xact lock, released on rollback even
    /// on panic via sqlx's drop-rollback). Returns guards to hold.
    async fn hold_sweep_lock(
        pool: &sqlx::PgPool,
    ) -> (tokio::sync::MutexGuard<'static, ()>, sqlx::Transaction<'static, sqlx::Postgres>) {
        let guard = sweep_lock().lock().await;
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(SWEEP_ADVISORY_KEY)
            .execute(&mut *tx)
            .await
            .unwrap();
        (guard, tx)
    }

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
                eprintln!("r2_p2_regression_tests (sla): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        // Same token value as intake's tests — parallel-safe (identical value).
        std::env::set_var("INTAKE_TOKEN", TEST_TOKEN);
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    fn test_headers() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-intake-token", TEST_TOKEN.parse().unwrap());
        h
    }

    async fn create_user(pool: &sqlx::PgPool, tag: &str, role: &str, active: bool) -> uuid::Uuid {
        let email = format!("r2-p2-sla-{tag}-{}@example.com", uuid::Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash, active) \
             VALUES ('R2 P2 SLA Tester', $1, $2, 'IT', 'test-hash', $3) RETURNING id",
        )
        .bind(&email)
        .bind(role)
        .bind(active)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Breached OPEN ticket. `due_expr` is a trusted SQL datetime
    /// expression (e.g. "NOW() - INTERVAL '2 hours'").
    async fn create_breached_ticket(
        pool: &sqlx::PgPool,
        number: &str,
        title: &str,
        requester: uuid::Uuid,
        assignee: Option<uuid::Uuid>,
        due_expr: &str,
    ) -> uuid::Uuid {
        let sql = format!(
            "INSERT INTO tickets (ticket_number, title, description, requester_id, assignee_id, status, sla_due_at) \
             VALUES ($1, $2, 'sla test', $3, $4, 'OPEN', {due_expr}) RETURNING id"
        );
        sqlx::query_scalar(&sql)
            .bind(number)
            .bind(title)
            .bind(requester)
            .bind(assignee)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn notifications_for(pool: &sqlx::PgPool, user: uuid::Uuid, tid: uuid::Uuid) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND ref_id = $2")
            .bind(user)
            .bind(tid)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn is_stamped(pool: &sqlx::PgPool, tid: uuid::Uuid) -> bool {
        let stamped: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT sla_escalated_at FROM tickets WHERE id = $1")
                .bind(tid)
                .fetch_one(pool)
                .await
                .unwrap();
        stamped.is_some()
    }

    // ── R2-BE-04 (#137): inactive assignee falls back to staff ──────────

    #[tokio::test]
    async fn inactive_assignee_falls_back_to_active_staff() {
        let Some(pool) = test_pool().await else { return };
        let (_guard, _tx_guard) = hold_sweep_lock(&pool).await;
        let uniq = uuid::Uuid::new_v4().simple().to_string();
        let staff = create_user(&pool, &format!("staff-{uniq}"), "AGENT", true).await;
        let inactive = create_user(&pool, &format!("inact-{uniq}"), "AGENT", false).await;
        let req = create_user(&pool, &format!("req-{uniq}"), "EMPLOYEE", true).await;
        let number = format!("INC-7{uniq}");
        let tid = create_breached_ticket(
            &pool,
            &number,
            "inactive assignee case",
            req,
            Some(inactive),
            "NOW() - INTERVAL '2 hours'",
        )
        .await;

        let out = escalate(State(test_state(pool.clone())), test_headers()).await.unwrap();
        assert!(out.0["escalated"].as_u64().unwrap() >= 1);

        assert!(is_stamped(&pool, tid).await, "breached ticket must be stamped via staff fallback");
        assert_eq!(0, notifications_for(&pool, inactive, tid).await, "inactive assignee must NOT be notified");
        assert_eq!(1, notifications_for(&pool, staff, tid).await, "active staff must get the fallback notice");
        let audits: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'SLA_ESCALATE' AND target_id = $1")
                .bind(tid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(1, audits);
    }

    #[tokio::test]
    async fn active_assignee_notified_directly_without_staff_spam() {
        let Some(pool) = test_pool().await else { return };
        let (_guard, _tx_guard) = hold_sweep_lock(&pool).await;
        let uniq = uuid::Uuid::new_v4().simple().to_string();
        let assignee = create_user(&pool, &format!("asg-{uniq}"), "AGENT", true).await;
        let other_staff = create_user(&pool, &format!("other-{uniq}"), "ADMIN", true).await;
        let req = create_user(&pool, &format!("req-{uniq}"), "EMPLOYEE", true).await;
        let number = format!("INC-6{uniq}");
        let tid = create_breached_ticket(
            &pool,
            &number,
            "active assignee case",
            req,
            Some(assignee),
            "NOW() - INTERVAL '2 hours'",
        )
        .await;

        let _ = escalate(State(test_state(pool.clone())), test_headers()).await.unwrap();

        assert!(is_stamped(&pool, tid).await, "breached ticket must be stamped");
        assert_eq!(1, notifications_for(&pool, assignee, tid).await, "active assignee notified directly");
        assert_eq!(0, notifications_for(&pool, other_staff, tid).await, "staff must not be spammed");
        let title: String = sqlx::query_scalar("SELECT title FROM notifications WHERE user_id = $1 AND ref_id = $2")
            .bind(assignee)
            .bind(tid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(format!("SLA breached: {number}"), title);
    }

    // ── R2-BE-05 (#138): LIMIT 200 oldest-first + stamp/notice consistency ──

    #[tokio::test]
    async fn sweep_stamps_at_most_200_oldest_first() {
        let Some(pool) = test_pool().await else { return };
        let (_guard, _tx_guard) = hold_sweep_lock(&pool).await;
        // purge stale batch rows from interrupted runs (same prefix family)
        sqlx::query("DELETE FROM tickets WHERE ticket_number LIKE 'BATCH-%'")
            .execute(&pool)
            .await
            .unwrap();
        let uniq = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        let req = create_user(&pool, &format!("req-{uniq}"), "EMPLOYEE", true).await;
        let assignee = create_user(&pool, &format!("asg-{uniq}"), "AGENT", true).await;
        // 201 breached, 30d+ old so they sort before any other test rows;
        // single active assignee → 1 notice per ticket, keeps this fast
        for g in 1..=201 {
            let num = format!("BATCH-{uniq}-{g:03}");
            let due_expr = format!("NOW() - INTERVAL '{} minutes'", 30 * 24 * 60 + g);
            create_breached_ticket(&pool, &num, "batch ticket", req, Some(assignee), &due_expr).await;
        }

        let out = escalate(State(test_state(pool.clone())), test_headers()).await.unwrap();
        assert_eq!(200, out.0["escalated"].as_u64().unwrap(), "one sweep must batch at most 200");

        let like = format!("BATCH-{uniq}-%");
        let stamped: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tickets WHERE ticket_number LIKE $1 AND sla_escalated_at IS NOT NULL",
        )
        .bind(&like)
        .fetch_one(&pool)
        .await
        .unwrap();
        let unstamped: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tickets WHERE ticket_number LIKE $1 AND sla_escalated_at IS NULL",
        )
        .bind(&like)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(201, stamped + unstamped);
        assert!(unstamped >= 1, "batching must leave ≥1 of the 201 for the next sweep");
        // oldest-first: every unstamped due is newer than every stamped due
        let max_stamped: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT MAX(sla_due_at) FROM tickets WHERE ticket_number LIKE $1 AND sla_escalated_at IS NOT NULL",
        )
        .bind(&like)
        .fetch_one(&pool)
        .await
        .unwrap();
        let min_unstamped: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT MIN(sla_due_at) FROM tickets WHERE ticket_number LIKE $1 AND sla_escalated_at IS NULL",
        )
        .bind(&like)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(min_unstamped.unwrap() > max_stamped.unwrap(), "sweep must take the oldest first");
        // durable-consistent: every stamped ticket has its notice
        let missing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tickets t WHERE t.ticket_number LIKE $1 AND t.sla_escalated_at IS NOT NULL \
             AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.ref_id = t.id AND n.kind = 'SLA_BREACH')",
        )
        .bind(&like)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(0, missing, "every stamped ticket must have its notice");

        // cleanup so reruns don't accumulate eligible rows
        sqlx::query("DELETE FROM tickets WHERE ticket_number LIKE $1")
            .bind(&like)
            .execute(&pool)
            .await
            .unwrap();
    }
}
