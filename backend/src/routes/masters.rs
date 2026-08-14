//! Masters: lookup options (departments, asset categories, ticket types,
//! priorities, statuses). GET is open to authenticated users (filters and
//! dropdowns read from here); mutations are ADMIN-only.

use axum::extract::{Extension, Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Map};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::LookupOption;
use crate::routes::AppError;

pub const FAMILIES: [&str; 5] = [
    "department",
    "asset_category",
    "ticket_type",
    "ticket_priority",
    "ticket_status",
];

#[derive(Deserialize)]
pub struct CreateOption {
    pub family: String,
    pub code: String,
    pub label: String,
    pub sort_order: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdateOption {
    pub label: Option<String>,
    pub sort_order: Option<i32>,
    pub active: Option<bool>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_masters))
        .merge(
            Router::new()
                .route("/", post(create_option))
                .route("/{id}", patch(update_option).delete(delete_option))
                .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin)),
        )
}

/// GET /api/v1/masters -> grouped map of all families:
/// `{ "department": [...], "asset_category": [...], ... }`
async fn list_masters(State(state): State<AppState>) -> Result<Json<Map<String, serde_json::Value>>, AppError> {
    let rows = sqlx::query_as::<_, LookupOption>(
        "SELECT id, family, code, label, sort_order, active, created_at
         FROM lookup_options ORDER BY family, sort_order, label",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut out = Map::new();
    for family in FAMILIES {
        let list: Vec<&LookupOption> = rows.iter().filter(|r| r.family == family).collect();
        out.insert(family.to_string(), json!(list));
    }
    Ok(Json(out))
}

async fn create_option(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateOption>,
) -> Result<(axum::http::StatusCode, Json<LookupOption>), AppError> {
    if !FAMILIES.contains(&body.family.as_str()) {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "unknown family",
        ));
    }
    if body.code.trim().is_empty() || body.label.trim().is_empty() {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "code and label required",
        ));
    }
    let code = body.code.trim().to_uppercase();
    let sort_order = body.sort_order.unwrap_or(0);

    let row = sqlx::query_as::<_, LookupOption>(
        "INSERT INTO lookup_options (family, code, label, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id, family, code, label, sort_order, active, created_at",
    )
    .bind(&body.family)
    .bind(&code)
    .bind(body.label.trim())
    .bind(sort_order)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => AppError::new(
            axum::http::StatusCode::CONFLICT,
            "code already exists in this family",
        ),
        other => AppError::from(other),
    })?;

    crate::audit::write(
        &state.pool,
        Some(actor_id),
        "MASTER_CREATE",
        "lookup_option",
        row.id,
        json!({ "old": {}, "new": { "family": row.family, "code": row.code, "label": row.label } }),
    )
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(row)))
}

async fn update_option(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateOption>,
) -> Result<Json<LookupOption>, AppError> {
    let existing = sqlx::query_as::<_, LookupOption>(
        "SELECT id, family, code, label, sort_order, active, created_at FROM lookup_options WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("option not found"))?;

    let row = sqlx::query_as::<_, LookupOption>(
        "UPDATE lookup_options SET
            label = COALESCE($1, label),
            sort_order = COALESCE($2, sort_order),
            active = COALESCE($3, active)
         WHERE id = $4
         RETURNING id, family, code, label, sort_order, active, created_at",
    )
    .bind(body.label.as_deref().map(str::trim))
    .bind(body.sort_order)
    .bind(body.active)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("option not found"))?;

    crate::audit::write(
        &state.pool,
        Some(actor_id),
        "MASTER_UPDATE",
        "lookup_option",
        row.id,
        json!({
            "old": { "label": existing.label, "sort_order": existing.sort_order, "active": existing.active },
            "new": { "label": row.label, "sort_order": row.sort_order, "active": row.active }
        }),
    )
    .await?;

    Ok(Json(row))
}

async fn delete_option(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let deleted = sqlx::query("DELETE FROM lookup_options WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::not_found("option not found"));
    }
    crate::audit::write(
        &state.pool,
        Some(actor_id),
        "MASTER_DELETE",
        "lookup_option",
        id,
        json!({ "old": {}, "new": {} }),
    )
    .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
