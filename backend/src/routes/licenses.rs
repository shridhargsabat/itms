// License/software seat tracking (P0-2, issue #38).
// Register (vendor, seats, expiry, cost), per-seat assign/revoke, seats-vs-used
// utilization, 90/60/30-day expiry alerts (same bucket pattern as warranty).

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::write,
    db::AppState,
    models::{
        AssignSeatRequest, CreateLicenseRequest, License, LicenseAllocation, UpdateLicenseRequest,
    },
};
use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_licenses).post(create_license))
        .route("/{id}", get(get_license).patch(update_license).delete(delete_license))
        .route("/{id}/assign", post(assign_seat))
        .route("/{id}/revoke", post(revoke_seat))
        .route("/alerts", get(license_alerts))
        .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin))
}

const LICENSE_SELECT: &str = "SELECT l.id, l.name, l.vendor, l.license_type, l.seats_total, \
    (SELECT COUNT(*) FROM license_allocations a WHERE a.license_id = l.id AND a.revoked_at IS NULL) AS seats_used, \
    l.cost_per_seat, l.cost_total, l.currency, l.expiry_date, l.renewal_cost, l.notes, l.active, \
    l.created_at, l.updated_at FROM licenses l";

#[derive(Deserialize)]
pub struct LicenseQuery {
    pub search: Option<String>,
    pub scope: Option<String>, // all | expired | expiring (90d)
    pub include_inactive: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

async fn list_licenses(
    State(state): State<AppState>,
    Query(q): Query<LicenseQuery>,
) -> Result<Json<Vec<License>>, AppError> {
    let pool = &state.pool;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);

    let mut sql = String::from(LICENSE_SELECT);
    sql.push_str(" WHERE 1 = 1");
    if q.include_inactive != Some(true) {
        sql.push_str(" AND l.active = TRUE");
    }
    if let Some(s) = q.search.as_deref() {
        let pat = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        sql.push_str(&format!(
            " AND (l.name ILIKE '%{pat}%' ESCAPE '\\' OR COALESCE(l.vendor, '') ILIKE '%{pat}%' ESCAPE '\\')"
        ));
    }
    match q.scope.as_deref() {
        Some("expired") => sql.push_str(" AND l.expiry_date IS NOT NULL AND l.expiry_date < CURRENT_DATE"),
        Some("expiring") => sql.push_str(
            " AND l.expiry_date IS NOT NULL AND l.expiry_date >= CURRENT_DATE \
               AND l.expiry_date <= CURRENT_DATE + 90",
        ),
        Some("all") | None => {}
        Some(_) => return Err(AppError::new(StatusCode::BAD_REQUEST, "scope must be all, expired or expiring")),
    }
    sql.push_str(" ORDER BY l.expiry_date ASC NULLS LAST, l.name");
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    let licenses = rows
        .iter()
        .map(|r| sqlx::FromRow::from_row(r).unwrap())
        .collect::<Vec<License>>();
    Ok(Json(licenses))
}

#[derive(Deserialize)]
pub struct AlertsQuery {
    pub scope: Option<String>, // all | expired | expiring
}

/// 90/60/30-day expiry buckets (mirrors warranty alerts).
async fn license_alerts(
    State(state): State<AppState>,
    Query(q): Query<AlertsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let scope = q.scope.as_deref().unwrap_or("all");
    if !matches!(scope, "all" | "expired" | "expiring") {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "scope must be all, expired or expiring"));
    }
    let expired = sqlx::query_as::<_, License>(&format!(
        "{LICENSE_SELECT} WHERE l.active = TRUE AND l.expiry_date IS NOT NULL \
         AND l.expiry_date < CURRENT_DATE ORDER BY l.expiry_date"
    ))
    .fetch_all(pool)
    .await?;
    let expiring = sqlx::query_as::<_, License>(&format!(
        "{LICENSE_SELECT} WHERE l.active = TRUE AND l.expiry_date IS NOT NULL \
         AND l.expiry_date >= CURRENT_DATE AND l.expiry_date <= CURRENT_DATE + 90 \
         ORDER BY l.expiry_date"
    ))
    .fetch_all(pool)
    .await?;

    let bucket = |days: i32| -> Vec<License> {
        expiring
            .iter()
            .filter(|l| {
                l.expiry_date
                    .map(|d| d <= chrono::Utc::now().date_naive() + chrono::Days::new(days as u64))
                    .unwrap_or(false)
            })
            .cloned()
            .collect()
    };

    let payload = json!({
        "expired": if scope == "all" || scope == "expired" { expired } else { vec![] },
        "expiring_30": if scope == "all" || scope == "expiring" { bucket(30) } else { vec![] },
        "expiring_60": if scope == "all" || scope == "expiring" { bucket(60) } else { vec![] },
        "expiring_90": if scope == "all" || scope == "expiring" { bucket(90) } else { vec![] },
    });
    Ok(Json(payload))
}

async fn get_license(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let lic: Option<License> =
        sqlx::query_as(&format!("{LICENSE_SELECT} WHERE l.id = $1"))
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(lic) = lic else {
        return Err(AppError::not_found("license not found"));
    };
    let allocations: Vec<LicenseAllocation> = sqlx::query_as(
        "SELECT a.id, a.license_id, a.user_id, a.assigned_at, a.revoked_at, \
                u.name AS user_name, u.email AS user_email \
         FROM license_allocations a JOIN users u ON u.id = a.user_id \
         WHERE a.license_id = $1 AND a.revoked_at IS NULL \
         ORDER BY a.assigned_at",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    Ok(Json(json!({ "license": lic, "allocations": allocations })))
}

async fn create_license(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateLicenseRequest>,
) -> Result<(StatusCode, Json<License>), AppError> {
    let pool = &state.pool;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "name is required"));
    }
    let lt = body.license_type.trim().to_uppercase();
    if !matches!(lt.as_str(), "SUBSCRIPTION" | "PERPETUAL" | "OPEN_SOURCE") {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            "license_type must be SUBSCRIPTION, PERPETUAL or OPEN_SOURCE",
        ));
    }
    if body.seats_total < 0 {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "seats_total must be >= 0"));
    }
    let currency = if body.currency.trim().is_empty() {
        "INR".to_string()
    } else {
        body.currency.trim().to_uppercase()
    };

    let lic = sqlx::query_as::<_, License>(
        "INSERT INTO licenses \
            (name, vendor, license_type, seats_total, cost_per_seat, cost_total, currency, expiry_date, renewal_cost, notes) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         RETURNING id, name, vendor, license_type, seats_total, 0::bigint AS seats_used, \
                   cost_per_seat, cost_total, currency, expiry_date, renewal_cost, notes, active, created_at, updated_at",
    )
    .bind(name)
    .bind(body.vendor.as_deref().map(str::trim))
    .bind(lt)
    .bind(body.seats_total)
    .bind(body.cost_per_seat)
    .bind(body.cost_total)
    .bind(currency)
    .bind(body.expiry_date)
    .bind(body.renewal_cost)
    .bind(body.notes)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "LICENSE_CREATE",
        "license",
        lic.id,
        json!({"name": name, "seats": lic.seats_total, "type": lic.license_type}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(lic)))
}

async fn update_license(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateLicenseRequest>,
) -> Result<Json<License>, AppError> {
    let pool = &state.pool;
    let exists =
        sqlx::query_as::<_, (String,)>("SELECT name FROM licenses WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("license not found"))?;

    // seats_total must never drop below currently-assigned count
    if let Some(seats) = body.seats_total {
        let used: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM license_allocations WHERE license_id = $1 AND revoked_at IS NULL",
        )
        .bind(id)
        .fetch_one(pool)
        .await?;
        if seats < used as i32 {
            return Err(AppError::new(
                StatusCode::BAD_REQUEST,
                format!("cannot reduce seats below {used} assigned"),
            ));
        }
    }

    let lic = sqlx::query_as::<_, License>(
        "UPDATE licenses SET \
            name = COALESCE($2, name), \
            vendor = CASE WHEN $3 THEN $4 ELSE COALESCE($4, vendor) END, \
            license_type = COALESCE($5, license_type), \
            seats_total = COALESCE($6, seats_total), \
            cost_per_seat = CASE WHEN $7 THEN $8 ELSE COALESCE($8, cost_per_seat) END, \
            cost_total = CASE WHEN $9 THEN $10 ELSE COALESCE($10, cost_total) END, \
            currency = COALESCE($11, currency), \
            expiry_date = CASE WHEN $12 THEN $13 ELSE COALESCE($13, expiry_date) END, \
            renewal_cost = CASE WHEN $14 THEN $15 ELSE COALESCE($15, renewal_cost) END, \
            notes = CASE WHEN $16 THEN $17 ELSE COALESCE($17, notes) END, \
            active = COALESCE($18, active), \
            updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, name, vendor, license_type, seats_total, \
                   (SELECT COUNT(*) FROM license_allocations a WHERE a.license_id = id AND a.revoked_at IS NULL) AS seats_used, \
                   cost_per_seat, cost_total, currency, expiry_date, renewal_cost, notes, active, created_at, updated_at",
    )
    .bind(id)
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.vendor.is_some())
    .bind(body.vendor.flatten())
    .bind(body.license_type.as_deref().map(|t| t.trim().to_uppercase()))
    .bind(body.seats_total)
    .bind(body.cost_per_seat.is_some())
    .bind(body.cost_per_seat.flatten())
    .bind(body.cost_total.is_some())
    .bind(body.cost_total.flatten())
    .bind(body.currency.as_deref().map(|c| c.trim().to_uppercase()))
    .bind(body.expiry_date.is_some())
    .bind(body.expiry_date.flatten())
    .bind(body.renewal_cost.is_some())
    .bind(body.renewal_cost.flatten())
    .bind(body.notes.is_some())
    .bind(body.notes.flatten())
    .bind(body.active)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "LICENSE_UPDATE",
        "license",
        id,
        json!({"name": exists.0}),
    )
    .await?;
    Ok(Json(lic))
}

async fn delete_license(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    let name =
        sqlx::query_as::<_, (String,)>("SELECT name FROM licenses WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("license not found"))?;
    sqlx::query("DELETE FROM licenses WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    write(
        pool,
        Some(actor_id),
        "LICENSE_DELETE",
        "license",
        id,
        json!({"name": name.0}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn assign_seat(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<AssignSeatRequest>,
) -> Result<(StatusCode, Json<LicenseAllocation>), AppError> {
    let pool = &state.pool;
    let lic =
        sqlx::query_as::<_, (String, i32)>("SELECT name, seats_total FROM licenses WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("license not found"))?;

    let user_ok =
        sqlx::query_as::<_, (String,)>("SELECT name FROM users WHERE id = $1 AND active = TRUE")
            .bind(body.user_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("user not found or inactive"))?;

    let used: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM license_allocations WHERE license_id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    if used >= lic.1 as i64 {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            format!("no seats left on {0} ({1}/{1} used)", lic.0, lic.1),
        ));
    }

    let dup = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM license_allocations WHERE license_id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(body.user_id)
    .fetch_optional(pool)
    .await?;
    if dup.is_some() {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "user already has a seat on this license",
        ));
    }

    let alloc = sqlx::query_as::<_, LicenseAllocation>(
        "INSERT INTO license_allocations (license_id, user_id) VALUES ($1, $2) \
         RETURNING id, license_id, user_id, assigned_at, revoked_at, \
                   (SELECT name FROM users WHERE id = $2) AS user_name, \
                   (SELECT email FROM users WHERE id = $2) AS user_email",
    )
    .bind(id)
    .bind(body.user_id)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "LICENSE_ASSIGN",
        "license",
        id,
        json!({"name": lic.0, "user": user_ok.0}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(alloc)))
}

async fn revoke_seat(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<AssignSeatRequest>,
) -> Result<Json<LicenseAllocation>, AppError> {
    let pool = &state.pool;
    let lic =
        sqlx::query_as::<_, (String,)>("SELECT name FROM licenses WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::not_found("license not found"))?;

    let alloc = sqlx::query_as::<_, LicenseAllocation>(
        "UPDATE license_allocations SET revoked_at = NOW() \
         WHERE license_id = $1 AND user_id = $2 AND revoked_at IS NULL \
         RETURNING id, license_id, user_id, assigned_at, revoked_at, \
                   (SELECT name FROM users WHERE id = $2) AS user_name, \
                   (SELECT email FROM users WHERE id = $2) AS user_email",
    )
    .bind(id)
    .bind(body.user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "no active seat for this user"))?;

    write(
        pool,
        Some(actor_id),
        "LICENSE_REVOKE",
        "license",
        id,
        json!({"name": lic.0, "user": alloc.user_name}),
    )
    .await?;
    Ok(Json(alloc))
}

// ── dashboard metric ────────────────────────────────────────────────────────

pub async fn license_alert_count(pool: &sqlx::PgPool) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM licenses WHERE active = TRUE AND expiry_date IS NOT NULL \
         AND expiry_date <= CURRENT_DATE + 90",
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}
