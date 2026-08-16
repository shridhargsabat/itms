use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::db::AppState;
use crate::models::{DashboardMetrics, DashboardMetricsScalars, MetricBucket};

use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new().route("/metrics", get(metrics))
}

/// GET /api/v1/dashboard/metrics
async fn metrics(
    State(state): State<AppState>,
) -> Result<Json<DashboardMetrics>, AppError> {
    let scalars = sqlx::query_as::<_, DashboardMetricsScalars>(
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
                WHERE status IN ('SUBMITTED', 'APPROVED', 'IN_PROGRESS'))                       AS open_requests,
            (SELECT COUNT(*) FROM licenses
                WHERE active = TRUE AND expiry_date IS NOT NULL
                  AND expiry_date <= CURRENT_DATE + 90)                                         AS license_alerts,
                (SELECT COUNT(*) FROM tickets
                  WHERE sla_due_at IS NOT NULL AND sla_due_at < NOW()
                    AND status IN ('OPEN', 'IN_PROGRESS'))                                     AS overdue_tickets
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    // Open tickets grouped by priority — sums to open_tickets (same status
    // filter), so the hero bar always matches its drill-down links.
    let tickets_by_priority: Vec<MetricBucket> = sqlx::query_as::<_, (String, i64)>(
        "SELECT priority AS key, COUNT(*)::int8 AS count FROM tickets
         WHERE status = 'OPEN'
         GROUP BY priority
         ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END",
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|(key, count)| MetricBucket { key, count })
    .collect();

    // Assets grouped by status — IN_STOCK bucket equals in_stock_count.
    let assets_by_status: Vec<MetricBucket> = sqlx::query_as::<_, (String, i64)>(
        "SELECT status AS key, COUNT(*)::int8 AS count FROM assets
         GROUP BY status
         ORDER BY CASE status WHEN 'IN_STOCK' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'MAINTENANCE' THEN 2 ELSE 3 END",
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|(key, count)| MetricBucket { key, count })
    .collect();

    Ok(Json(DashboardMetrics {
        asset_count: scalars.asset_count,
        open_tickets: scalars.open_tickets,
        high_priority_count: scalars.high_priority_count,
        in_stock_count: scalars.in_stock_count,
        warranty_alerts_count: scalars.warranty_alerts_count,
        onboarding_overdue: scalars.onboarding_overdue,
        open_requests: scalars.open_requests,
        license_alerts: scalars.license_alerts,
        overdue_tickets: scalars.overdue_tickets,
        tickets_by_priority,
        assets_by_status,
    }))
}
