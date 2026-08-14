//! Shared audit-log writer (immutable rows, JSON diffs).

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn write(
    pool: &PgPool,
    actor_id: Option<Uuid>,
    action: &str,
    target_type: &str,
    target_id: Uuid,
    diff: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(actor_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(diff)
    .execute(pool)
    .await?;
    Ok(())
}
