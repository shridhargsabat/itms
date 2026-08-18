use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use super::assets::ASSET_SELECT;
use crate::models::{Asset, Location, LocationWithCount};
use super::AppError;

/// #40: Location master (site/building/floor/room hierarchy).
/// Reads: any authed user. Writes: ADMIN only (same pattern as vendors).

pub async fn router() -> Router<super::AppState> {
    Router::new()
        .route("/", get(list_locations))
        .route("/{id}/assets", get(location_assets))
        .route("/", post(create_location))
        .route("/{id}", put(update_location).delete(delete_location))
}

fn require_admin(role: &str) -> Result<(), AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admin only"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct LocationListParams {
    pub search: Option<String>,
}

/// GET /locations — flat list with per-location asset counts.
/// Intentionally unpaginated: small master data, fetched whole for dropdowns.
pub async fn list_locations(
    State(state): State<super::AppState>,
    Query(params): Query<LocationListParams>,
) -> Result<Json<Vec<LocationWithCount>>, AppError> {
    let mut qb = sqlx::QueryBuilder::new(
        "SELECT l.id, l.site, l.building, l.floor, l.room, l.created_at, \
         (SELECT COUNT(*) FROM assets a WHERE a.location_id = l.id) AS asset_count \
         FROM locations l",
    );
    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let pat = format!("%{}%", search.to_lowercase());
        qb.push(" WHERE LOWER(l.site || ' / ' || l.building || ' / ' || l.floor || ' / ' || l.room) LIKE ")
            .push_bind(pat);
    }
    qb.push(" ORDER BY l.site, l.building, l.floor, l.room");
    let rows = qb.build_query_as::<LocationWithCount>().fetch_all(&state.pool).await?;
    Ok(Json(rows))
}

/// GET /locations/{id}/assets — assets currently at a location.
pub async fn location_assets(
    State(state): State<super::AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<Vec<Asset>>, AppError> {
    let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM locations WHERE id = $1)")
        .bind(id).fetch_one(&state.pool).await?;
    if !ok {
        return Err(AppError::new(StatusCode::NOT_FOUND, "location not found"));
    }
    let rows = sqlx::query_as::<_, Asset>(&format!("{ASSET_SELECT} WHERE a.location_id = $1 ORDER BY a.asset_tag"))
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct LocationInput {
    pub site: Option<String>,
    pub building: Option<String>,
    pub floor: Option<String>,
    pub room: Option<String>,
}

fn normalize_input(body: &LocationInput) -> Result<(String, String, String, String), AppError> {
    let site = body.site.clone().unwrap_or_default().trim().to_string();
    let building = body.building.clone().unwrap_or_default().trim().to_string();
    let floor = body.floor.clone().unwrap_or_default().trim().to_string();
    let room = body.room.clone().unwrap_or_default().trim().to_string();
    if site.is_empty() && building.is_empty() && floor.is_empty() && room.is_empty() {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "location needs at least one level (site/building/floor/room)",
        ));
    }
    Ok((site, building, floor, room))
}

fn unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.is_unique_violation())
}

/// POST /locations (admin)
pub async fn create_location(
    State(state): State<super::AppState>,
    Extension(role): Extension<String>,
    Json(body): Json<LocationInput>,
) -> Result<(StatusCode, Json<Location>), AppError> {
    require_admin(&role)?;
    let (site, building, floor, room) = normalize_input(&body)?;
    let row = sqlx::query_as::<_, Location>(
        "INSERT INTO locations (site, building, floor, room) VALUES ($1, $2, $3, $4) \
         RETURNING id, site, building, floor, room, created_at",
    )
    .bind(&site).bind(&building).bind(&floor).bind(&room)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if unique_violation(&e) {
            AppError::new(StatusCode::CONFLICT, "location already exists")
        } else {
            AppError::from(e)
        }
    })?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// PUT /locations/{id} (admin)
pub async fn update_location(
    State(state): State<super::AppState>,
    Extension(role): Extension<String>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<LocationInput>,
) -> Result<Json<Location>, AppError> {
    require_admin(&role)?;
    let (site, building, floor, room) = normalize_input(&body)?;
    let row = sqlx::query_as::<_, Location>(
        "UPDATE locations SET site = $2, building = $3, floor = $4, room = $5 \
         WHERE id = $1 RETURNING id, site, building, floor, room, created_at",
    )
    .bind(id).bind(&site).bind(&building).bind(&floor).bind(&room)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        if unique_violation(&e) {
            AppError::new(StatusCode::CONFLICT, "location already exists")
        } else {
            AppError::from(e)
        }
    })?
    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "location not found"))?;
    Ok(Json(row))
}

/// DELETE /locations/{id} (admin) — blocked while assets reference it.
pub async fn delete_location(
    State(state): State<super::AppState>,
    Extension(role): Extension<String>,
    Path(id): Path<uuid::Uuid>,
) -> Result<StatusCode, AppError> {
    require_admin(&role)?;
    let in_use: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE location_id = $1)")
        .bind(id).fetch_one(&state.pool).await?;
    if in_use {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "location still has assets — move them first",
        ));
    }
    let deleted = sqlx::query("DELETE FROM locations WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::new(StatusCode::NOT_FOUND, "location not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}