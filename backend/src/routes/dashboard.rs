use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::db::AppState;
use crate::models::DashboardMetrics;

use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new().route("/metrics", get(metrics))
}

/// GET /api/v1/dashboard/metrics
async fn metrics(
    State(state): State<AppState>,
) -> Result<Json<DashboardMetrics>, AppError> {
    let metrics = sqlx::query_as::<_, DashboardMetrics>(
        r#"
        SELECT
            (SELECT COUNT(*) FROM assets)                                                        AS asset_count,
            -- Semantics MUST match the drill-down filters (tickets?status=OPEN,
            -- tickets?priority=HIGH, assets?status=IN_STOCK) so a card's number
            -- always equals the rows its link shows.
            (SELECT COUNT(*) FROM tickets WHERE status = 'OPEN')                                 AS open_tickets,
            (SELECT COUNT(*) FROM tickets WHERE priority = 'HIGH')                                AS high_priority_count,
            (SELECT COUNT(*) FROM assets WHERE status = 'IN_STOCK')                              AS in_stock_count,
            (SELECT COUNT(*) FROM assets
                WHERE status <> 'RETIRED' AND warranty_expiry IS NOT NULL
                  AND warranty_expiry <= CURRENT_DATE + 90)                                       AS warranty_alerts_count,
            (SELECT COUNT(*) FROM onboarding_tasks t
                JOIN onboarding_events e ON e.id = t.event_id
                WHERE e.status = 'OPEN' AND t.status = 'PENDING'
                  AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)                     AS onboarding_overdue,
            (SELECT COUNT(*) FROM service_requests
                WHERE status IN ('SUBMITTED', 'APPROVED', 'IN_PROGRESS'))                       AS open_requests
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(metrics))
}
