use axum::http::HeaderMap;
use sqlx::{Postgres, QueryBuilder};

/// Standard pagination parsing for every list endpoint.
///
/// `limit: None` means "no pagination — return all rows" (preserved:
/// the tickets kanban board and dropdown consumers rely on unlimited
/// fetches). Clamps are the single standard across all list endpoints.
pub fn page_params(limit: Option<i64>, offset: Option<i64>) -> (Option<i64>, i64) {
    (limit.map(|l| l.clamp(1, 500)), offset.unwrap_or(0).max(0))
}

/// Append " LIMIT ? OFFSET ?" (bound values) only when a limit was
/// requested. OFFSET 0 is skipped because it is a no-op.
pub fn push_pagination<'a>(qb: &mut QueryBuilder<'a, Postgres>, limit: Option<i64>, offset: i64) {
    if let Some(limit) = limit {
        qb.push(" LIMIT ").push_bind(limit);
        if offset > 0 {
            qb.push(" OFFSET ").push_bind(offset);
        }
    }
}

/// Response header carrying the filtered total so clients can render the
/// page count (and "Showing X–Y of Z") without a second request.
pub fn total_header(total: i64) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("x-total-count", total.to_string().parse().unwrap());
    h
}
