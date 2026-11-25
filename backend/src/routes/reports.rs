// #49: repeat-incident detection (problem-lite). Groups tickets by normalized
// title + asset to surface recurring issues. NO problem records — report only.
use axum::{extract::{Query, State}, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder};
use uuid::Uuid;

use super::AppError;
use crate::db::AppState;

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RepeatIncident {
    title: String,
    ticket_type: String,
    count: i64,
    last_at: chrono::DateTime<Utc>,
    asset_tag: Option<String>,
    asset_id: Option<Uuid>,
    ticket_numbers: Vec<String>,
}

#[derive(Deserialize)]
pub struct RepeatParams {
    days: Option<i64>,
    min_count: Option<i64>,
    ticket_type: Option<String>,
}

/// GET /reports/repeat-incidents?days=90&min_count=2&ticket_type=
/// Groups OPEN+CLOSED tickets by lower(trim(title)) + asset; surfaces the
/// top recurring patterns (P2, problem-lite).
pub async fn repeat_incidents(
    State(state): State<AppState>,
    Query(params): Query<RepeatParams>,
) -> Result<Json<Vec<RepeatIncident>>, AppError> {
    let days = params.days.unwrap_or(90).clamp(7, 730);
    let min_count = params.min_count.unwrap_or(2).clamp(2, 50);
    let mut qb = QueryBuilder::new(
        "SELECT lower(btrim(title)) AS title, mode() WITHIN GROUP (ORDER BY t.ticket_type) AS ticket_type, \
         COUNT(*) AS count, MAX(t.created_at) AS last_at, a.asset_tag, t.asset_id, \
         ARRAY_AGG(t.ticket_number ORDER BY t.created_at DESC) AS ticket_numbers \
         FROM tickets t LEFT JOIN assets a ON a.id = t.asset_id",
    );
    qb.push(" WHERE t.created_at >= NOW() - make_interval(days => ")
        .push_bind(days as i32)
        .push(")")
        .push(" AND btrim(title) <> ''");
    if let Some(tt) = params.ticket_type.as_deref().map(str::trim).filter(|s| !s.is_empty() && *s != "ALL") {
        // TBE-34: normalize like the ticket list (was case-sensitive exact).
        let normalized = super::tickets::normalize_ticket_type(Some(tt));
        if normalized == "SERVICE_REQUEST" {
            // Match historical 'REQUEST' rows too.
            qb.push(" AND t.ticket_type IN ('SERVICE_REQUEST', 'REQUEST')");
        } else {
            qb.push(" AND t.ticket_type = ").push_bind(normalized);
        }
    }
    qb.push(" GROUP BY lower(btrim(title)), t.asset_id, a.asset_tag \
             HAVING COUNT(*) >= ")
        .push_bind(min_count)
        .push(" ORDER BY count DESC, last_at DESC LIMIT 50");
    let rows = qb.build_query_as::<RepeatIncident>().fetch_all(&state.pool).await?;
    Ok(Json(rows))
}
