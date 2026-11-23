use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::AppState;
use crate::models::{
    DashboardMetrics, DashboardMetricsScalars, MetricBucket, VelocityPoint, VelocityResponse,
};

use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/metrics", get(metrics))
        .route("/velocity", get(velocity))
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

#[derive(Debug, Deserialize)]
struct VelocityParams {
    range: Option<String>,
}

/// GET /api/v1/dashboard/velocity?range=7d|30d
///
/// Ticket flow over time: incidents opened, service requests opened, and
/// tickets resolved (TICKET_STATUS audit transitions into RESOLVED/CLOSED).
/// `7d` (default) returns 7 daily rows (today-6..today); `30d` returns 4
/// weekly rows (7-day buckets ending today, oldest first). Auth is inherited
/// from the dashboard router's middleware, same as /metrics.
async fn velocity(
    State(state): State<AppState>,
    Query(params): Query<VelocityParams>,
) -> Result<Json<VelocityResponse>, AppError> {
    let range = params.range.as_deref().unwrap_or("7d");
    // Tuple decode + map, same style as the metrics breakdowns above.
    let rows: Vec<(String, i64, i64, i64)> = match range {
        "7d" => {
            sqlx::query_as(
                r#"
                SELECT to_char(CURRENT_DATE - 6 + g.n, 'Dy') AS day,
                       COALESCE(i.cnt, 0)::int8 AS incidents,
                       COALESCE(r.cnt, 0)::int8 AS requests,
                       COALESCE(s.cnt, 0)::int8 AS resolved
                FROM generate_series(0, 6) AS g(n)
                LEFT JOIN (
                    SELECT created_at::date AS d, COUNT(*) AS cnt FROM tickets
                    WHERE ticket_type = 'INCIDENT' AND created_at::date >= CURRENT_DATE - 6
                    GROUP BY 1
                ) i ON i.d = (CURRENT_DATE - 6 + g.n)
                LEFT JOIN (
                    SELECT created_at::date AS d, COUNT(*) AS cnt FROM tickets
                    WHERE ticket_type IN ('SERVICE_REQUEST', 'REQUEST') AND created_at::date >= CURRENT_DATE - 6
                    GROUP BY 1
                ) r ON r.d = (CURRENT_DATE - 6 + g.n)
                LEFT JOIN (
                    SELECT created_at::date AS d, COUNT(*) AS cnt FROM audit_logs
                    WHERE action = 'TICKET_STATUS' AND target_type = 'ticket'
                      AND diff->>'to' IN ('RESOLVED', 'CLOSED')
                      AND created_at::date >= CURRENT_DATE - 6
                    GROUP BY 1
                ) s ON s.d = (CURRENT_DATE - 6 + g.n)
                ORDER BY g.n
                "#,
            )
            .fetch_all(&state.pool)
            .await?
        }
        "30d" => {
            sqlx::query_as(
                r#"
                SELECT 'Wk ' || (g.w + 1) AS day,
                       COALESCE(i.cnt, 0)::int8 AS incidents,
                       COALESCE(r.cnt, 0)::int8 AS requests,
                       COALESCE(s.cnt, 0)::int8 AS resolved
                FROM generate_series(0, 3) AS g(w)
                LEFT JOIN (
                    SELECT ((created_at::date - (CURRENT_DATE - 27)) / 7) AS w, COUNT(*) AS cnt
                    FROM tickets
                    WHERE ticket_type = 'INCIDENT' AND created_at::date >= CURRENT_DATE - 27
                    GROUP BY 1
                ) i ON i.w = g.w
                LEFT JOIN (
                    SELECT ((created_at::date - (CURRENT_DATE - 27)) / 7) AS w, COUNT(*) AS cnt
                    FROM tickets
                    WHERE ticket_type IN ('SERVICE_REQUEST', 'REQUEST') AND created_at::date >= CURRENT_DATE - 27
                    GROUP BY 1
                ) r ON r.w = g.w
                LEFT JOIN (
                    SELECT ((created_at::date - (CURRENT_DATE - 27)) / 7) AS w, COUNT(*) AS cnt
                    FROM audit_logs
                    WHERE action = 'TICKET_STATUS' AND target_type = 'ticket'
                      AND diff->>'to' IN ('RESOLVED', 'CLOSED')
                      AND created_at::date >= CURRENT_DATE - 27
                    GROUP BY 1
                ) s ON s.w = g.w
                ORDER BY g.w
                "#,
            )
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            return Err(AppError::new(
                StatusCode::BAD_REQUEST,
                "range must be one of: 7d, 30d",
            ));
        }
    };

    let points = rows
        .into_iter()
        .map(|(day, incidents, requests, resolved)| VelocityPoint {
            day,
            incidents,
            requests,
            resolved,
        })
        .collect();

    Ok(Json(VelocityResponse {
        range: range.to_string(),
        points,
    }))
}
