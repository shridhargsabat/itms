// #39: vendor master + claim/repair log. Staff create/edit, admin deletes;
// claims readable by any authed user (asset detail shows them), staff create.
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool, QueryBuilder};
use uuid::Uuid;

use super::AppError;
use crate::db::AppState;

/// Same gates as templates.rs/kb.rs: EMPLOYEE is read-only.
fn require_staff(role: &str) -> Result<(), AppError> {
    if role == "EMPLOYEE" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "agents and admins only"));
    }
    Ok(())
}

fn require_admin(role: &str) -> Result<(), AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admins only"));
    }
    Ok(())
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Vendor {
    id: Uuid,
    name: String,
    contact_name: Option<String>,
    contact_email: Option<String>,
    contact_phone: Option<String>,
    support_link: Option<String>,
    amc_expiry: Option<NaiveDate>,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    id: Uuid,
    vendor_id: Uuid,
    asset_id: Option<Uuid>,
    ticket_id: Option<Uuid>,
    issue: String,
    outcome: Option<String>,
    replacement: bool,
    created_at: chrono::DateTime<Utc>,
    asset_tag: Option<String>,
    asset_name: Option<String>,
    ticket_number: Option<String>,
    vendor_name: Option<String>,
}

const VENDOR_SELECT: &str = "SELECT id, name, contact_name, contact_email, contact_phone, \
     support_link, amc_expiry, created_at, updated_at FROM vendors";
const CLAIM_SELECT: &str = "SELECT c.id, c.vendor_id, c.asset_id, c.ticket_id, c.issue, c.outcome, \
     c.replacement, c.created_at, a.asset_tag, a.name AS asset_name, t.ticket_number, v.name AS vendor_name \
     FROM vendor_claims c LEFT JOIN assets a ON a.id = c.asset_id \
     LEFT JOIN tickets t ON t.id = c.ticket_id LEFT JOIN vendors v ON v.id = c.vendor_id";

#[derive(Deserialize)]
pub struct VendorInput {
    name: String,
    contact_name: Option<String>,
    contact_email: Option<String>,
    contact_phone: Option<String>,
    support_link: Option<String>,
    amc_expiry: Option<NaiveDate>,
}

fn validate(v: &VendorInput) -> Result<(), AppError> {
    if v.name.trim().is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "vendor name is required"));
    }
    if v.name.len() > 120 {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "vendor name too long (max 120)"));
    }
    Ok(())
}

/// GET /vendors — all vendors (any authed user; asset detail needs the name)
pub async fn list_vendors(
    State(state): State<AppState>,
    _: (),
) -> Result<Json<Vec<Vendor>>, AppError> {
    let rows = sqlx::query_as::<_, Vendor>(&format!("{VENDOR_SELECT} ORDER BY name"))
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

/// POST /vendors — staff+
pub async fn create_vendor(
    State(state): State<AppState>,
    Extension(_actor): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<VendorInput>,
) -> Result<(StatusCode, Json<Vendor>), AppError> {
    require_staff(&role)?;
    validate(&body)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO vendors (name, contact_name, contact_email, contact_phone, \
         support_link, amc_expiry, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(body.name.trim())
    .bind(body.contact_name)
    .bind(body.contact_email)
    .bind(body.contact_phone)
    .bind(body.support_link)
    .bind(body.amc_expiry)
    .bind(_actor)
    .fetch_one(&state.pool)
    .await?;
    let row = sqlx::query_as::<_, Vendor>(&format!("{VENDOR_SELECT} WHERE id = $1"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    sqlx::query("INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) VALUES ($1, 'VENDOR_CREATED', 'vendor', $2, $3)")
        .bind(_actor).bind(row.id).bind(json!({"name": row.name})).execute(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// PUT /vendors/:id — staff+
pub async fn update_vendor(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(_actor): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<VendorInput>,
) -> Result<Json<Vendor>, AppError> {
    require_staff(&role)?;
    validate(&body)?;
    let updated: Option<Uuid> = sqlx::query_scalar(
        "UPDATE vendors SET name = $1, contact_name = $2, contact_email = $3, \
         contact_phone = $4, support_link = $5, amc_expiry = $6, updated_at = NOW() \
         WHERE id = $7 RETURNING id",
    )
    .bind(body.name.trim())
    .bind(body.contact_name)
    .bind(body.contact_email)
    .bind(body.contact_phone)
    .bind(body.support_link)
    .bind(body.amc_expiry)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(updated) = updated else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "vendor not found"));
    };
    let row = sqlx::query_as::<_, Vendor>(&format!("{VENDOR_SELECT} WHERE id = $1"))
        .bind(updated)
        .fetch_one(&state.pool)
        .await?;
    sqlx::query("INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) VALUES ($1, 'VENDOR_UPDATED', 'vendor', $2, $3)")
        .bind(_actor).bind(id).bind(json!({"name": row.name})).execute(&state.pool).await?;
    Ok(Json(row))
}

/// DELETE /vendors/:id — admin only
pub async fn delete_vendor(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(_actor): Extension<Uuid>,
    Extension(role): Extension<String>,
) -> Result<StatusCode, AppError> {
    require_admin(&role)?;
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM vendors WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(name) = name else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "vendor not found"));
    };
    // claims cascade (ON DELETE CASCADE); assets keep vendor_id NULL via SET NULL
    sqlx::query("DELETE FROM vendors WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    sqlx::query("INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) VALUES ($1, 'VENDOR_DELETED', 'vendor', $2, $3)")
        .bind(_actor).bind(id).bind(json!({"name": name})).execute(&state.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct ClaimListParams {
    vendor_id: Option<Uuid>,
    asset_id: Option<Uuid>,
    limit: Option<i64>,
}

/// GET /claims?vendor_id=&asset_id= — any authed user
pub async fn list_claims(
    State(state): State<AppState>,
    Query(params): Query<ClaimListParams>,
) -> Result<Json<Vec<Claim>>, AppError> {
    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let mut qb = QueryBuilder::new(CLAIM_SELECT);
    let mut any = false;
    if let Some(v) = params.vendor_id {
        any = true;
        qb.push(" WHERE c.vendor_id = ").push_bind(v);
    }
    if let Some(a) = params.asset_id {
        if any {
            qb.push(" AND ");
        } else {
            qb.push(" WHERE ");
        }
        qb.push("c.asset_id = ").push_bind(a);
    }
    qb.push(" ORDER BY c.created_at DESC LIMIT ").push_bind(limit);
    let rows = qb.build_query_as::<Claim>().fetch_all(&state.pool).await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ClaimInput {
    vendor_id: Uuid,
    asset_id: Option<Uuid>,
    ticket_id: Option<Uuid>,
    issue: String,
    outcome: Option<String>,
    #[serde(default)]
    replacement: bool,
}

/// POST /claims — staff+
pub async fn create_claim(
    State(state): State<AppState>,
    Extension(_actor): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<ClaimInput>,
) -> Result<(StatusCode, Json<Claim>), AppError> {
    require_staff(&role)?;
    if body.issue.trim().is_empty() {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "issue description is required"));
    }
    let vendor_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM vendors WHERE id = $1)")
        .bind(body.vendor_id)
        .fetch_one(&state.pool)
        .await?;
    if !vendor_exists {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "vendor not found"));
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO vendor_claims (vendor_id, asset_id, ticket_id, issue, outcome, replacement, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(body.vendor_id)
    .bind(body.asset_id)
    .bind(body.ticket_id)
    .bind(body.issue.trim())
    .bind(body.outcome)
    .bind(body.replacement)
    .bind(_actor)
    .fetch_one(&state.pool)
    .await?;
    let row = sqlx::query_as::<_, Claim>(&format!("{CLAIM_SELECT} WHERE c.id = $1"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    sqlx::query("INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) VALUES ($1, 'CLAIM_CREATED', 'vendor_claim', $2, $3)")
        .bind(_actor).bind(row.id).bind(json!({"vendor": row.vendor_name, "issue": row.issue})).execute(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// DELETE /claims/:id — admin only
pub async fn delete_claim(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(_actor): Extension<Uuid>,
    Extension(role): Extension<String>,
) -> Result<StatusCode, AppError> {
    require_admin(&role)?;
    let gone = sqlx::query("DELETE FROM vendor_claims WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if gone == 0 {
        return Err(AppError::new(StatusCode::NOT_FOUND, "claim not found"));
    }
    sqlx::query("INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) VALUES ($1, 'CLAIM_DELETED', 'vendor_claim', $2, '{}')")
        .bind(_actor).bind(id).execute(&state.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

