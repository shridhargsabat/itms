use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, QueryBuilder};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{Asset, AssignAssetRequest, CreateAssetRequest};

use super::AppError;

/// Shared joined SELECT so every handler returns the same enriched shape.
const ASSET_SELECT: &str = "SELECT a.id, a.asset_tag, a.name, a.category, a.serial_number, \
     a.status, a.assigned_to_user_id, a.specs, a.purchase_date, a.warranty_expiry, \
     a.created_at, a.updated_at, u.name AS assigned_user_name \
     FROM assets a LEFT JOIN users u ON u.id = a.assigned_to_user_id";

/// RETURNING clause mirroring ASSET_SELECT's columns (assigned_user_name is
/// always NULL on a freshly inserted/updated row here).
const ASSET_RETURNING: &str = "RETURNING id, asset_tag, name, category, serial_number, status, \
     assigned_to_user_id, specs, purchase_date, warranty_expiry, created_at, updated_at, \
     NULL::text AS assigned_user_name";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_assets).post(create_asset))
        .route("/{id}/assign", patch(assign_asset))
}

#[derive(Debug, Deserialize)]
pub struct AssetListParams {
    pub search: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
}

/// GET /api/v1/assets?search=&category=&status=
async fn list_assets(
    State(state): State<AppState>,
    Query(params): Query<AssetListParams>,
) -> Result<Json<Vec<Asset>>, AppError> {
    let mut qb = QueryBuilder::new(ASSET_SELECT);
    qb.push(" WHERE ");
    let mut any = false;

    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
        }
        let pattern = format!("%{search}%");
        qb.push("(a.name ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.asset_tag ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.serial_number ILIKE ")
            .push_bind(pattern)
            .push(")");
        any = true;
    }
    if let Some(category) = params.category.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
        }
        qb.push("a.category = ").push_bind(category);
        any = true;
    }
    if let Some(status) = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
        }
        qb.push("a.status = ").push_bind(status);
        any = true;
    }
    if !any {
        qb.push("1 = 1");
    }

    qb.push(" ORDER BY a.created_at DESC");

    let assets = qb.build_query_as::<Asset>().fetch_all(&state.pool).await?;
    Ok(Json(assets))
}

/// POST /api/v1/assets → 201 with auto-generated AST-XXXX tag + audit row.
async fn create_asset(
    State(state): State<AppState>,
    Json(body): Json<CreateAssetRequest>,
) -> Result<(StatusCode, Json<Asset>), AppError> {
    let asset = insert_asset_with_tag_retry(&state.pool, &body).await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_CREATE', 'asset', $1, $2)",
    )
    .bind(asset.id)
    .bind(json!({
        "old": {},
        "new": {
            "asset_tag": &asset.asset_tag,
            "name": &asset.name,
            "category": &asset.category,
            "serial_number": &asset.serial_number,
            "status": &asset.status,
            "specs": &asset.specs,
        }
    }))
    .execute(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(asset)))
}

/// PATCH /api/v1/assets/{id}/assign — body {assigned_to_user_id: uuid|null}.
async fn assign_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
    Json(body): Json<AssignAssetRequest>,
) -> Result<Json<Asset>, AppError> {
    let current: Option<Asset> = sqlx::query_as::<_, Asset>(&format!("{ASSET_SELECT} WHERE a.id = $1"))
        .bind(asset_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(current) = current else {
        return Err(AppError::not_found("asset not found"));
    };

    // Guard against a dangling FK reference (would otherwise 500).
    if let Some(user_id) = body.assigned_to_user_id {
        let user_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await?;
        if !user_exists {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "assigned_to_user_id does not reference an existing user",
            ));
        }
    }

    let updated: Asset = sqlx::query_as::<_, Asset>(&format!(
        "UPDATE assets SET assigned_to_user_id = $2, updated_at = NOW() \
         WHERE id = $1 {ASSET_RETURNING}"
    ))
    .bind(asset_id)
    .bind(body.assigned_to_user_id)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_ASSIGN', 'asset', $1, $2)",
    )
    .bind(asset_id)
    .bind(json!({
        "old_user_id": current.assigned_to_user_id,
        "new_user_id": body.assigned_to_user_id,
    }))
    .execute(&state.pool)
    .await?;

    Ok(Json(updated))
}

/// Asset tag generation: `SELECT count(*) FROM assets` + 1 → `AST-{:04}`,
/// retrying on unique-violation races (concurrent creates).
async fn insert_asset_with_tag_retry(
    pool: &PgPool,
    body: &CreateAssetRequest,
) -> Result<Asset, AppError> {
    let specs = body.specs.clone().unwrap_or_else(|| json!({}));
    let status = body.status.clone().unwrap_or_else(|| "IN_STOCK".to_string());

    for attempt in 0..3 {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assets")
            .fetch_one(pool)
            .await?;
        let asset_tag = format!("AST-{:04}", count + 1);

        let result = sqlx::query_as::<_, Asset>(&format!(
            "INSERT INTO assets (asset_tag, name, category, serial_number, status, specs, purchase_date, warranty_expiry) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) {ASSET_RETURNING}"
        ))
        .bind(&asset_tag)
        .bind(&body.name)
        .bind(&body.category)
        .bind(&body.serial_number)
        .bind(&status)
        .bind(&specs)
        .bind(body.purchase_date)
        .bind(body.warranty_expiry)
        .fetch_one(pool)
        .await;

        match result {
            Ok(asset) => return Ok(asset),
            Err(sqlx::Error::Database(db_err))
                if db_err.is_unique_violation()
                    && db_err.constraint() == Some("assets_asset_tag_key")
                    && attempt < 2 =>
            {
                tracing::warn!("asset tag {asset_tag} collided, retrying");
                continue;
            }
            Err(err) => return Err(err.into()),
        }
    }

    Err(AppError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate a unique asset tag",
    ))
}
