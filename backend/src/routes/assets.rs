use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Extension, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{PgPool, QueryBuilder};
use std::collections::HashSet;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{
    Asset, AssetMove, AssignAssetRequest, CreateAssetRequest, LifecycleEvent, UpdateAssetRequest,
    WarrantyAlert,
};

use super::AppError;

/// Shared joined SELECT so every handler returns the same enriched shape.
pub const ASSET_SELECT: &str = "SELECT a.id, a.asset_tag, a.name, a.category, a.serial_number, \
     a.status, a.assigned_to_user_id, a.specs, a.purchase_date, a.warranty_expiry, \
     a.unit_cost, a.expected_eol, a.created_at, a.updated_at, u.name AS assigned_user_name, \
     a.location_id, CASE WHEN l.id IS NULL THEN NULL \
       ELSE concat_ws(' / ', NULLIF(l.site, ''), NULLIF(l.building, ''), NULLIF(l.floor, ''), NULLIF(l.room, '')) END AS location_name, \
     ROUND((a.unit_cost * LEAST(1.0, GREATEST(0.0, \
        (CURRENT_DATE - COALESCE(a.purchase_date, a.expected_eol))::float8 / 1095.0)))::numeric, 2)::float8 \
        AS current_value, a.vendor_id, v.name AS vendor_name \
     FROM assets a LEFT JOIN users u ON u.id = a.assigned_to_user_id \
     LEFT JOIN vendors v ON v.id = a.vendor_id \
     LEFT JOIN locations l ON l.id = a.location_id";

/// RETURNING clause mirroring ASSET_SELECT's columns (assigned_user_name is
/// always NULL on a freshly inserted/updated row here).
const ASSET_RETURNING: &str = "RETURNING id, asset_tag, name, category, serial_number, status, \
     assigned_to_user_id, specs, purchase_date, warranty_expiry, unit_cost, expected_eol, \
     created_at, updated_at, NULL::text AS assigned_user_name, \
     ROUND((unit_cost * LEAST(1.0, GREATEST(0.0, \
        (CURRENT_DATE - COALESCE(purchase_date, expected_eol))::float8 / 1095.0)))::numeric, 2)::float8 \
        AS current_value, vendor_id, NULL::text AS vendor_name, \
     location_id, (SELECT concat_ws(' / ', NULLIF(site, ''), NULLIF(building, ''), NULLIF(floor, ''), NULLIF(room, '')) \
        FROM locations WHERE id = location_id) AS location_name";

/// #40: record a location move (fire-and-forget; never blocks the update).
async fn log_location_move(
    pool: &PgPool,
    asset_id: Uuid,
    from_location_id: Option<Uuid>,
    to_location_id: Option<Uuid>,
    actor_id: Option<Uuid>,
    note: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO asset_moves (asset_id, from_location_id, to_location_id, actor_id, note)          VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(asset_id)
    .bind(from_location_id)
    .bind(to_location_id)
    .bind(actor_id)
    .bind(note)
    .execute(pool)
    .await?;
    Ok(())
}

/// GET /assets/{id}/moves — move history (newest first, joined names).
async fn asset_moves(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<Vec<AssetMove>>, AppError> {
    let rows = sqlx::query_as::<_, AssetMove>(
        "SELECT m.id, m.asset_id, m.from_location_id, m.to_location_id, \
         fl.site || CASE WHEN NULLIF(fl.building,'') IS NULL THEN '' ELSE ' / ' || fl.building END || \
         CASE WHEN NULLIF(fl.floor,'') IS NULL THEN '' ELSE ' / ' || fl.floor END || \
         CASE WHEN NULLIF(fl.room,'') IS NULL THEN '' ELSE ' / ' || fl.room END AS from_location_name, \
         tl.site || CASE WHEN NULLIF(tl.building,'') IS NULL THEN '' ELSE ' / ' || tl.building END || \
         CASE WHEN NULLIF(tl.floor,'') IS NULL THEN '' ELSE ' / ' || tl.floor END || \
         CASE WHEN NULLIF(tl.room,'') IS NULL THEN '' ELSE ' / ' || tl.room END AS to_location_name, \
         m.actor_id, u.name AS actor_name, m.note, m.created_at \
         FROM asset_moves m \
         LEFT JOIN locations fl ON fl.id = m.from_location_id \
         LEFT JOIN locations tl ON tl.id = m.to_location_id \
         LEFT JOIN users u ON u.id = m.actor_id \
         WHERE m.asset_id = $1 ORDER BY m.created_at DESC",
    )
    .bind(asset_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub fn router() -> Router<AppState> {
    // Reads: any authenticated user (assignee dropdowns, lists, exports).
    Router::new()
        .route("/", get(list_assets))
        .route("/alerts", get(warranty_alerts))
        .route("/{id}/lifecycle", get(asset_lifecycle))
        .route("/{id}/scan-audit", post(scan_audit))
        .route("/{id}/moves", get(asset_moves))
        .route("/export", get(export_assets))
        // Mutations: ADMIN-only (security audit H1 — was open to every
        // authenticated role incl. EMPLOYEE; mass-delete/import/financial
        // fields must stay admin-gated). Same pattern as users/masters.
        .merge(
            Router::new()
                .route("/", post(create_asset))
                .route("/{id}", patch(update_asset))
                .route("/{id}/assign", patch(assign_asset))
                .route("/import", post(import_assets).layer(DefaultBodyLimit::max(10 * 1024 * 1024)))
                .route("/bulk/status", patch(bulk_update_status))
                .route("/bulk/assign", patch(bulk_assign))
                .route("/bulk", delete(bulk_delete))
                .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin)),
        )
}

#[derive(Debug, Deserialize)]
pub struct AssetListParams {
    pub search: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub order: Option<String>,
    /// Comma-separated asset UUIDs — used by export to emit a selection.
    #[serde(default)]
    pub ids: Option<String>,
    /// #40: filter to one location.
    pub location_id: Option<uuid::Uuid>,
}

/// Whitelisted ORDER BY columns (never interpolate user input directly).
fn asset_sort(col: &str) -> &'static str {
    match col {
        "name" => "a.name",
        "tag" => "a.asset_tag",
        "category" => "a.category",
        "status" => "a.status",
        "serial_number" => "a.serial_number",
        "updated_at" => "a.updated_at",
        _ => "a.created_at",
    }
}

/// GET /api/v1/assets?search=&category=&status=
async fn list_assets(
    State(state): State<AppState>,
    Query(params): Query<AssetListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    // Data query + count query share the SAME filter pushes (same bind order).
    let mut qb = QueryBuilder::new(ASSET_SELECT);
    let mut cqb = QueryBuilder::new("SELECT COUNT(*) FROM assets a");
    qb.push(" WHERE ");
    cqb.push(" WHERE ");
    let mut any = false;

    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        let pattern = format!("%{search}%");
        qb.push("(a.name ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.asset_tag ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.serial_number ILIKE ")
            .push_bind(pattern.clone())
            .push(")");
        cqb.push("(a.name ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.asset_tag ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.serial_number ILIKE ")
            .push_bind(pattern.clone())
            .push(")");
        any = true;
    }
    if let Some(category) = params.category.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("a.category = ").push_bind(category);
        cqb.push("a.category = ").push_bind(category);
        any = true;
    }
    if let Some(location_id) = params.location_id {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("a.location_id = ").push_bind(location_id);
        cqb.push("a.location_id = ").push_bind(location_id);
        any = true;
    }
    if let Some(status) = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if any {
            qb.push(" AND ");
            cqb.push(" AND ");
        }
        qb.push("a.status = ").push_bind(status);
        cqb.push("a.status = ").push_bind(status);
        any = true;
    }
    if !any {
        qb.push("1 = 1");
        cqb.push("1 = 1");
    }

    qb.push(" ORDER BY ").push(asset_sort(params.sort.as_deref().unwrap_or("created_at")));
    if params.order.as_deref() == Some("asc") {
        qb.push(" ASC");
    } else {
        qb.push(" DESC");
    }
    let (limit, offset) = crate::pagination::page_params(params.limit, params.offset);
    crate::pagination::push_pagination(&mut qb, limit, offset);

    let assets = qb.build_query_as::<Asset>().fetch_all(&state.pool).await?;
    let total: i64 = if limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        assets.len() as i64
    };
    Ok((crate::pagination::total_header(total), Json(assets)))
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

    // Auto-transition lifecycle status: assignment moves the asset to
    // ASSIGNED (from stock/repair), unassignment returns it to IN_STOCK
    // (RETIRED assets stay retired — assignment is a no-op there).
    let target_status = match (current.status.as_str(), body.assigned_to_user_id.is_some()) {
        ("RETIRED", _) => "RETIRED".to_string(),
        (_, true) => "ASSIGNED".to_string(),
        (_, false) => "IN_STOCK".to_string(),
    };
    if !can_transition(&current.status, &target_status) {
        return Err(transition_error(&current.status, &target_status));
    }

    let updated: Asset = sqlx::query_as::<_, Asset>(&format!(
        "UPDATE assets SET assigned_to_user_id = $2, status = $3, updated_at = NOW() \
         WHERE id = $1 {ASSET_RETURNING}"
    ))
    .bind(asset_id)
    .bind(body.assigned_to_user_id)
    .bind(&target_status)
    .fetch_one(&state.pool)
    .await?;

    if target_status != current.status {
        log_lifecycle_event(
            &state.pool,
            asset_id,
            Some(&current.status),
            &target_status,
            Some("assignment changed"),
        )
        .await?;
    }

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

// ---------------------------------------------------------------------------
// Lifecycle state machine (issue #36)
// ---------------------------------------------------------------------------

/// Allowed lifecycle transitions (Snipe-IT-inspired; RETIRED is reversible to
/// IN_STOCK for correction/re-activation).
fn can_transition(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        ("IN_STOCK", "ASSIGNED")
            | ("IN_STOCK", "MAINTENANCE")
            | ("IN_STOCK", "RETIRED")
            | ("ASSIGNED", "IN_STOCK")
            | ("ASSIGNED", "MAINTENANCE")
            | ("ASSIGNED", "RETIRED")
            | ("MAINTENANCE", "IN_STOCK")
            | ("MAINTENANCE", "ASSIGNED")
            | ("MAINTENANCE", "RETIRED")
            | ("RETIRED", "IN_STOCK")
    )
}

fn transition_error(from: &str, to: &str) -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        format!("invalid lifecycle transition {from} → {to}"),
    )
}

/// Record a lifecycle event (fire-and-forget: never blocks the update).
async fn log_lifecycle_event(
    pool: &PgPool,
    asset_id: Uuid,
    from_status: Option<&str>,
    to_status: &str,
    note: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO asset_lifecycle_events (asset_id, from_status, to_status, actor_id, note) \
         VALUES ($1, $2, $3, NULL, $4)",
    )
    .bind(asset_id)
    .bind(from_status)
    .bind(to_status)
    .bind(note)
    .execute(pool)
    .await?;
    Ok(())
}

/// PATCH /api/v1/assets/{id} — partial update (name, category, serial,
/// status w/ transition validation, specs, dates, cost). Each field is
/// optional; `null` for dates/cost clears the value. Status changes are
/// recorded in the lifecycle history.
async fn update_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
    Extension(uid): Extension<Uuid>,
    Json(body): Json<UpdateAssetRequest>,
) -> Result<Json<Asset>, AppError> {
    let current: Option<Asset> = sqlx::query_as::<_, Asset>(&format!("{ASSET_SELECT} WHERE a.id = $1"))
        .bind(asset_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(current) = current else {
        return Err(AppError::not_found("asset not found"));
    };

    if let Some(cat) = body.category.as_deref() {
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM lookup_options WHERE family = 'asset_category' AND code = $1 AND active)",
        )
        .bind(cat)
        .fetch_one(&state.pool)
        .await?;
        if !valid {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("invalid category '{cat}'"),
            ));
        }
    }

    if let Some(Some(vid)) = body.vendor_id {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM vendors WHERE id = $1)")
            .bind(vid).fetch_one(&state.pool).await?;
        if !ok {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid vendor_id"));
        }
    }
    if let Some(Some(lid)) = body.location_id {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM locations WHERE id = $1)")
            .bind(lid).fetch_one(&state.pool).await?;
        if !ok {
            return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid location_id"));
        }
    }

    let new_status = body.status.as_deref().map(str::trim).map(str::to_uppercase);
    if let Some(status) = &new_status {
        if !can_transition(&current.status, status) {
            return Err(transition_error(&current.status, status));
        }
    }

    // Dynamic SET clause: absent (None) = leave unchanged, explicit null
    // (Some(None)) = clear the field. COALESCE cannot express "clear", so the
    // SET list is built from what the request actually contains. All binds are
    // Option<String> with explicit SQL casts (::date, ::float8, ::jsonb) so
    // one type flows through the whole macro; binds are collected in the SAME
    // order as the SET columns, then WHERE id = $n+1.
    let mut q = String::from("UPDATE assets SET ");
    let mut binds: Vec<Option<String>> = Vec::new();
    macro_rules! col {
        ($sql:expr, $v:expr, $cast:expr) => {{
            let v: Option<String> = $v;
            if v.is_some() {
                if !binds.is_empty() {
                    q.push_str(", ");
                }
                q.push_str(&format!("{} = ${}{}", $sql, binds.len() + 1, $cast));
                binds.push(v);
            }
        }};
    }
    macro_rules! colopt {
        ($sql:expr, $v:expr, $cast:expr) => {{
            let v = $v;
            if v.is_some() {
                if !binds.is_empty() {
                    q.push_str(", ");
                }
                q.push_str(&format!("{} = ${}{}", $sql, binds.len() + 1, $cast));
                binds.push(v.flatten().map(|x| x.to_string()));
            }
        }};
    }
    col!("name", body.name, "");
    col!("category", body.category, "");
    col!("serial_number", body.serial_number, "");
    col!("status", new_status.clone(), "");
    col!("specs", body.specs.map(|s| s.to_string()), "::jsonb");
    colopt!("purchase_date", body.purchase_date, "::date");
    colopt!("warranty_expiry", body.warranty_expiry, "::date");
    colopt!("unit_cost", body.unit_cost, "::float8");
    colopt!("expected_eol", body.expected_eol, "::date");
    colopt!("vendor_id", body.vendor_id, "::uuid");
    colopt!("location_id", body.location_id, "::uuid");
    // Nothing to update → no-op: return the asset unchanged (no invalid
    // `SET , updated_at` query).
    if binds.is_empty() {
        return Ok(Json(current));
    }
    q.push_str(", updated_at = NOW()");
    q.push_str(&format!(" WHERE id = ${} {ASSET_RETURNING}", binds.len() + 1));

    let mut qb = sqlx::query_as::<_, Asset>(&q);
    for b in binds {
        qb = qb.bind(b);
    }
    qb = qb.bind(asset_id);
    let updated: Asset = qb.fetch_one(&state.pool).await?;

    // Lifecycle event for the status change (if any).
    if let Some(to) = &new_status {
        if to != &current.status {
            log_lifecycle_event(&state.pool, asset_id, Some(&current.status), to, None).await?;
        }
    }

    // #40: location move (fire-and-forget log for traceability).
    if updated.location_id != current.location_id {
        log_location_move(
            &state.pool,
            asset_id,
            current.location_id,
            updated.location_id,
            Some(uid),
            "location updated",
        )
        .await?;
    }

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_UPDATE', 'asset', $1, $2)",
    )
    .bind(asset_id)
    .bind(json!({
        "old": {
            "name": current.name, "category": current.category,
            "serial_number": current.serial_number, "status": current.status,
            "purchase_date": current.purchase_date, "warranty_expiry": current.warranty_expiry,
            "unit_cost": current.unit_cost, "expected_eol": current.expected_eol,
        },
        "new": {
            "name": updated.name, "category": updated.category,
            "serial_number": updated.serial_number, "status": updated.status,
            "purchase_date": updated.purchase_date, "warranty_expiry": updated.warranty_expiry,
            "unit_cost": updated.unit_cost, "expected_eol": updated.expected_eol,
        }
    }))
    .execute(&state.pool)
    .await?;

    Ok(Json(updated))
}

/// GET /api/v1/assets/{id}/lifecycle — status transition history (newest first).
async fn asset_lifecycle(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<Vec<LifecycleEvent>>, AppError> {
    let events = sqlx::query_as::<_, LifecycleEvent>(
        "SELECT e.id, e.asset_id, e.from_status, e.to_status, e.actor_id, e.note, e.created_at, \
                u.name AS actor_name \
         FROM asset_lifecycle_events e \
         LEFT JOIN users u ON u.id = e.actor_id \
         WHERE e.asset_id = $1 \
         ORDER BY e.created_at DESC",
    )
    .bind(asset_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(events))
}

/// GET /api/v1/assets/alerts?scope=all|expired|expiring — warranty expiring
/// within 90 days or already expired (excludes RETIRED). days_left < 0 =
/// expired. Scope lets the UI fetch buckets separately so thousands of
/// expired warranties cannot drown the expiring-soon list.
async fn warranty_alerts(
    State(state): State<AppState>,
    Query(params): Query<AlertParams>,
) -> Result<Json<Vec<WarrantyAlert>>, AppError> {
    let scope = params.scope.as_deref().unwrap_or("all");
    let mut q = String::from(
        "SELECT id, asset_tag, name, status, warranty_expiry, \
                (warranty_expiry - CURRENT_DATE)::bigint AS days_left \
         FROM assets \
         WHERE status <> 'RETIRED' AND warranty_expiry IS NOT NULL \
           AND warranty_expiry <= CURRENT_DATE + 90",
    );
    match scope {
        "expired" => q.push_str(" AND warranty_expiry < CURRENT_DATE"),
        "expiring" => q.push_str(" AND warranty_expiry >= CURRENT_DATE"),
        "all" => {}
        _ => {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "scope must be one of: all, expired, expiring",
            ));
        }
    }
    q.push_str(" ORDER BY warranty_expiry ASC LIMIT 500");

    let alerts = sqlx::query_as::<_, WarrantyAlert>(&q)
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(alerts))
}

#[derive(Debug, Deserialize)]
pub struct AlertParams {
    pub scope: Option<String>,
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

        if let Some(location_id) = body.location_id {
            let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM locations WHERE id = $1)")
                .bind(location_id).fetch_one(pool).await?;
            if !ok {
                return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid location_id"));
            }
        }
        let result = sqlx::query_as::<_, Asset>(&format!(
            "INSERT INTO assets (asset_tag, name, category, serial_number, status, specs, purchase_date, warranty_expiry, unit_cost, expected_eol, vendor_id, location_id) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) {ASSET_RETURNING}"
        ))
        .bind(&asset_tag)
        .bind(&body.name)
        .bind(&body.category)
        .bind(&body.serial_number)
        .bind(&status)
        .bind(&specs)
        .bind(body.purchase_date)
        .bind(body.warranty_expiry)
        .bind(body.unit_cost)
        .bind(body.expected_eol)
        .bind(body.vendor_id)
        .bind(body.location_id)
        .fetch_one(pool)
        .await;

        match result {
            Ok(asset) => {
                // #40: record the initial placement as the first move entry.
                if let Some(loc) = body.location_id {
                    sqlx::query(
                        "INSERT INTO asset_moves (asset_id, from_location_id, to_location_id, actor_id, note) \
                         VALUES ($1, NULL, $2, NULL, 'initial placement')",
                    )
                    .bind(asset.id)
                    .bind(loc)
                    .execute(pool)
                    .await?;
                }
                return Ok(asset);
            }
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

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ImportFailure {
    pub row: usize,
    pub error: String,
    pub data: Map<String, Value>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub failed: Vec<ImportFailure>,
}

enum InsertError {
    Row(String),
    Fatal(AppError),
}

fn csv_err(e: csv::Error) -> AppError {
    AppError::new(StatusCode::BAD_REQUEST, format!("csv error: {e}"))
}

/// POST /api/v1/assets/import — CSV body with headers:
/// name, category, serial_number, status?, purchase_date?, warranty_expiry?,
/// asset_tag?, assigned_to? (user email), specs? (JSON object).
/// Valid rows are inserted (auto tag when asset_tag is empty); invalid rows
/// are reported per-row — partial success is the contract.
async fn import_assets(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<ImportResult>, AppError> {
    let text = String::from_utf8_lossy(&body);
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes());
    let headers: Vec<String> = rdr
        .headers()
        .map_err(csv_err)?
        .iter()
        .map(|h| h.trim().to_lowercase())
        .collect();
    let col = |name: &str| headers.iter().position(|h| h == name);

    for req in ["name", "category", "serial_number"] {
        if col(req).is_none() {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("missing required column: {req}"),
            ));
        }
    }

    // Valid categories come from the masters lookup (active only).
    let cats: HashSet<String> = sqlx::query_scalar(
        "SELECT code FROM lookup_options WHERE family = 'asset_category' AND active",
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .collect();

    const KNOWN_STATUSES: [&str; 4] = ["IN_STOCK", "ASSIGNED", "MAINTENANCE", "RETIRED"];

    let mut imported: usize = 0;
    let mut failed: Vec<ImportFailure> = Vec::new();

    for (i, record) in rdr.records().enumerate() {
        let row_no = i + 2; // 1-based; header row is 1
        let record = match record {
            Ok(r) => r,
            Err(e) => {
                failed.push(ImportFailure {
                    row: row_no,
                    error: format!("parse error: {e}"),
                    data: Map::new(),
                });
                continue;
            }
        };
        let get = |name: &str| -> Option<&str> {
            col(name)
                .and_then(|i| record.get(i))
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };

        // Echo the row's non-empty cells back in `data` so the UI can show
        // which record failed.
        let mut data = Map::new();
        for (h, v) in headers.iter().zip(record.iter()) {
            if !v.trim().is_empty() {
                data.insert(h.clone(), Value::String(v.trim().to_string()));
            }
        }

        let mut errs: Vec<String> = Vec::new();
        let name = get("name").unwrap_or("").to_string();
        let category = get("category").unwrap_or("").to_uppercase();
        let serial = get("serial_number").unwrap_or("").to_string();
        if name.is_empty() {
            errs.push("name is required".into());
        }
        if category.is_empty() {
            errs.push("category is required".into());
        } else if !cats.contains(&category) {
            errs.push(format!("unknown category '{category}'"));
        }
        if serial.is_empty() {
            errs.push("serial_number is required".into());
        }

        let status = get("status").unwrap_or("IN_STOCK").to_uppercase();
        if !KNOWN_STATUSES.contains(&status.as_str()) {
            errs.push(format!("invalid status '{status}'"));
        }

        let parse_date = |v: Option<&str>, field: &str| -> (Option<NaiveDate>, Option<String>) {
            match v {
                None => (None, None),
                Some(d) => match NaiveDate::parse_from_str(d, "%Y-%m-%d") {
                    Ok(date) => (Some(date), None),
                    Err(_) => (None, Some(format!("invalid {field} '{d}' (expected YYYY-MM-DD)"))),
                },
            }
        };
        let (purchase_date, e1) = parse_date(get("purchase_date"), "purchase_date");
        let (warranty_expiry, e2) = parse_date(get("warranty_expiry"), "warranty_expiry");
        let (expected_eol, e3) = parse_date(get("expected_eol"), "expected_eol");
        errs.extend(e1.into_iter().chain(e2).chain(e3));

        let unit_cost: Option<f64> = match get("unit_cost") {
            None => None,
            Some(c) => match c.parse::<f64>() {
                Ok(v) if v >= 0.0 => Some(v),
                _ => {
                    errs.push(format!("invalid unit_cost '{c}'"));
                    None
                }
            },
        };

        let specs: Value = match get("specs") {
            None => json!({}),
            Some(s) => match serde_json::from_str::<Value>(s) {
                Ok(v @ Value::Object(_)) => v,
                Ok(_) => {
                    errs.push("specs must be a JSON object".into());
                    json!({})
                }
                Err(_) => {
                    errs.push("specs is not valid JSON".into());
                    json!({})
                }
            },
        };

        let assigned_to_user_id = match get("assigned_to") {
            None => None,
            Some(email) => {
                let id: Option<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM users WHERE lower(email) = lower($1) AND active",
                )
                .bind(email)
                .fetch_optional(&state.pool)
                .await?;
                match id {
                    Some(id) => Some(id),
                    None => {
                        errs.push(format!("unknown user email '{email}'"));
                        None
                    }
                }
            }
        };

        if !errs.is_empty() {
            failed.push(ImportFailure {
                row: row_no,
                error: errs.join("; "),
                data,
            });
            continue;
        }

        let custom_tag = get("asset_tag").map(str::to_string);
        match insert_imported_asset(
            &state.pool,
            &name,
            &category,
            &serial,
            &status,
            assigned_to_user_id,
            &specs,
            purchase_date,
            warranty_expiry,
            unit_cost,
            expected_eol,
            custom_tag,
        )
        .await
        {
            Ok(_) => imported += 1,
            Err(InsertError::Row(msg)) => failed.push(ImportFailure {
                row: row_no,
                error: msg,
                data,
            }),
            Err(InsertError::Fatal(e)) => return Err(e),
        }
    }

    if imported > 0 || !failed.is_empty() {
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES (NULL, 'ASSET_IMPORT', 'asset', $1, $2)",
        )
        .bind(Uuid::new_v4())
        .bind(json!({ "imported": imported, "failed": failed.len() }))
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(ImportResult { imported, failed }))
}

/// Insert one imported asset. `custom_tag` is honored verbatim (a collision is
/// a Row error); when None the AST-{:04} counter is used with retries.
async fn insert_imported_asset(
    pool: &PgPool,
    name: &str,
    category: &str,
    serial: &str,
    status: &str,
    assigned_to_user_id: Option<Uuid>,
    specs: &Value,
    purchase_date: Option<NaiveDate>,
    warranty_expiry: Option<NaiveDate>,
    unit_cost: Option<f64>,
    expected_eol: Option<NaiveDate>,
    custom_tag: Option<String>,
) -> Result<Asset, InsertError> {
    for attempt in 0..3 {
        let asset_tag = match &custom_tag {
            Some(t) => t.clone(),
            None => {
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assets")
                    .fetch_one(pool)
                    .await
                    .map_err(|e| InsertError::Fatal(e.into()))?;
                format!("AST-{:04}", count + 1)
            }
        };
        let result = sqlx::query_as::<_, Asset>(&format!(
            "INSERT INTO assets (asset_tag, name, category, serial_number, status, \
             assigned_to_user_id, specs, purchase_date, warranty_expiry, unit_cost, expected_eol) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) {ASSET_RETURNING}"
        ))
        .bind(&asset_tag)
        .bind(name)
        .bind(category)
        .bind(serial)
        .bind(status)
        .bind(assigned_to_user_id)
        .bind(specs)
        .bind(purchase_date)
        .bind(warranty_expiry)
        .bind(unit_cost)
        .bind(expected_eol)
        .fetch_one(pool)
        .await;

        match result {
            Ok(asset) => return Ok(asset),
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                let cons = db_err.constraint().unwrap_or("");
                if cons == "assets_serial_number_key" {
                    return Err(InsertError::Row("serial_number already exists".into()));
                }
                if cons == "assets_asset_tag_key" && custom_tag.is_some() {
                    return Err(InsertError::Row(format!(
                        "asset_tag '{asset_tag}' already exists"
                    )));
                }
                if cons == "assets_asset_tag_key" && attempt < 2 {
                    continue; // auto-tag race, retry
                }
                return Err(InsertError::Row(format!(
                    "unique constraint violation: {cons}"
                )));
            }
            Err(err) => return Err(InsertError::Fatal(err.into())),
        }
    }
    Err(InsertError::Row(
        "could not allocate a unique asset tag".into(),
    ))
}

/// GET /api/v1/assets/export?search=&category=&status= — CSV download of the
/// filtered registry (mirrors list_assets filters; capped at 10k rows).
async fn export_assets(
    State(state): State<AppState>,
    Query(params): Query<AssetListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut qb = QueryBuilder::new(ASSET_SELECT);
    qb.push(" WHERE ");
    let mut any = false;
    if let Some(search) = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        any = true;
        let pattern = format!("%{search}%");
        qb.push("(a.name ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.asset_tag ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR a.serial_number ILIKE ")
            .push_bind(pattern.clone())
            .push(")");
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
    // Export a specific selection: ids=a,b,c (bulk export from the UI).
    if let Some(ids_csv) = params.ids.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let ids: Vec<Uuid> = ids_csv
            .split(',')
            .filter_map(|p| p.trim().parse::<Uuid>().ok())
            .collect();
        if ids.is_empty() {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "ids must be a comma-separated list of valid UUIDs",
            ));
        }
        if ids.len() > BULK_MAX_IDS {
            return Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("too many ids (max {BULK_MAX_IDS})"),
            ));
        }
        // NOTE: QueryBuilder::push_bind INLINES values into the SQL text —
        // a Vec<Uuid> becomes an unquoted `{...}` array literal, a bare Uuid
        // is inlined WITHOUT quotes, and a String binds as TEXT (no `uuid =
        // text` operator). Since `ids` are already validated by
        // `parse::<Uuid>()`, inline them as quoted literals: Postgres coerces
        // 'uuid' literals to uuid (index-friendly) and there is no injection
        // surface.
        // The `AND` here is UNCONDITIONAL: WHERE is always followed by either
        // a filter chain or the `1 = 1` fallback — never nothing. Guarding it
        // with `if any` produced `WHERE 1 = 1a.id IN (...)` on pure ids
        // exports (the `"1a"` error).
        qb.push(" AND ");
        qb.push("a.id IN (");
        for (i, id) in ids.iter().enumerate() {
            if i > 0 {
                qb.push(", ");
            }
            qb.push("'").push(id.to_string()).push("'");
        }
        qb.push(")");
    }
    qb.push(" ORDER BY ")
        .push(asset_sort(params.sort.as_deref().unwrap_or("created_at")));
    if params.order.as_deref() == Some("asc") {
        qb.push(" ASC");
    } else {
        qb.push(" DESC");
    }
    qb.push(" LIMIT 10000");

    let assets = qb.build_query_as::<Asset>().fetch_all(&state.pool).await?;

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record([
        "asset_tag",
        "name",
        "category",
        "serial_number",
        "status",
        "assigned_to",
        "purchase_date",
        "warranty_expiry",
        "unit_cost",
        "expected_eol",
        "current_value",
        "specs",
        "created_at",
    ])
    .map_err(csv_err)?;
    for a in &assets {
        wtr.write_record(vec![
            crate::routes::csv_safe(&a.asset_tag),
            crate::routes::csv_safe(&a.name),
            crate::routes::csv_safe(&a.category),
            crate::routes::csv_safe(&a.serial_number),
            crate::routes::csv_safe(&a.status),
            crate::routes::csv_safe(&a.assigned_user_name.clone().unwrap_or_default()),
            crate::routes::csv_safe(&a.purchase_date.map(|d| d.to_string()).unwrap_or_default()),
            crate::routes::csv_safe(&a.warranty_expiry.map(|d| d.to_string()).unwrap_or_default()),
            crate::routes::csv_safe(&a.unit_cost.map(|c| format!("{c:.2}")).unwrap_or_default()),
            crate::routes::csv_safe(&a.expected_eol.map(|d| d.to_string()).unwrap_or_default()),
            crate::routes::csv_safe(&a.current_value.map(|c| format!("{c:.2}")).unwrap_or_default()),
            crate::routes::csv_safe(&a.specs.to_string()),
            a.created_at.to_rfc3339(),
        ])
        .map_err(csv_err)?;
    }
    let body = wtr
        .into_inner()
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("csv write error: {}", e.into_error())))?;

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"assets.csv\"",
            ),
        ],
        body,
    ))
}

// ---------------------------------------------------------------------------
// Bulk operations (multi-select: status, assign, delete, export-by-ids)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BulkIds {
    pub ids: Vec<Uuid>,
}

/// POST /assets/{id}/scan-audit — physical audit scan. ANY authed user may
/// record one (factory-floor audits); each scan logs a lifecycle event +
/// audit-log row. Returns the found-asset snapshot for scanner confirmation.
#[derive(Debug, Serialize)]
pub struct QrScanResult {
    pub asset_tag: String,
    pub name: String,
    pub status: String,
    pub serial_number: String,
}

pub async fn scan_audit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(uid): Extension<Uuid>,
) -> Result<Json<QrScanResult>, AppError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String)>(
        "SELECT id, asset_tag, name, status, serial_number FROM assets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("asset not found"))?;

    log_lifecycle_event(&state.pool, row.0, Some(&row.3), &row.3, Some("QR scan audit")).await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'ASSET_SCAN_AUDIT', 'asset', $2, $3)",
    )
    .bind(uid)
    .bind(id)
    .bind(json!({"tag": row.1, "name": row.2}))
    .execute(&state.pool)
    .await?;

    Ok(Json(QrScanResult {
        asset_tag: row.1,
        name: row.2,
        status: row.3,
        serial_number: row.4,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BulkStatusRequest {
    pub ids: Vec<Uuid>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct BulkAssignRequest {
    pub ids: Vec<Uuid>,
    pub assigned_to_user_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct BulkResult {
    pub updated: i64,
}

const BULK_MAX_IDS: usize = 500;

fn validate_bulk_ids(ids: &[Uuid]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ids must not be empty",
        ));
    }
    if ids.len() > BULK_MAX_IDS {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("too many ids (max {BULK_MAX_IDS})"),
        ));
    }
    Ok(())
}

/// PATCH /api/v1/assets/bulk/status — {ids, status} → update all matching rows.
async fn bulk_update_status(
    State(state): State<AppState>,
    Json(body): Json<BulkStatusRequest>,
) -> Result<Json<BulkResult>, AppError> {
    validate_bulk_ids(&body.ids)?;
    let status = body.status.trim().to_uppercase();
    const KNOWN_STATUSES: [&str; 4] = ["IN_STOCK", "ASSIGNED", "MAINTENANCE", "RETIRED"];
    if !KNOWN_STATUSES.contains(&status.as_str()) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid status '{status}'"),
        ));
    }

    // Per-asset lifecycle validation: reject the batch if ANY asset cannot
    // make the requested transition (no partial surprises).
    let current_statuses: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT status FROM assets WHERE id = ANY($1)",
    )
    .bind(&body.ids)
    .fetch_all(&state.pool)
    .await?;
    for from in &current_statuses {
        if !can_transition(from, &status) {
            return Err(transition_error(from, &status));
        }
    }

    // Lifecycle history for every changed asset — MUST run BEFORE the UPDATE
    // (from_status reads the pre-change value).
    sqlx::query(
        "INSERT INTO asset_lifecycle_events (asset_id, from_status, to_status, actor_id, note) \
         SELECT id, status, $2, NULL, 'bulk status change' FROM assets WHERE id = ANY($1) \
           AND status <> $2",
    )
    .bind(&body.ids)
    .bind(&status)
    .execute(&state.pool)
    .await?;

    let result = sqlx::query(
        "UPDATE assets SET status = $2, updated_at = NOW() WHERE id = ANY($1)",
    )
    .bind(&body.ids)
    .bind(&status)
    .execute(&state.pool)
    .await?;
    let updated = result.rows_affected() as i64;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_BULK_STATUS', 'asset', $1, $2)",
    )
    .bind(Uuid::new_v4())
    .bind(json!({ "count": updated, "status": status }))
    .execute(&state.pool)
    .await?;

    Ok(Json(BulkResult { updated }))
}

/// PATCH /api/v1/assets/bulk/assign — {ids, assigned_to_user_id|null} → (un)assign all.
async fn bulk_assign(
    State(state): State<AppState>,
    Json(body): Json<BulkAssignRequest>,
) -> Result<Json<BulkResult>, AppError> {
    validate_bulk_ids(&body.ids)?;

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

    // Auto-transition lifecycle status with the assignment (assign →
    // ASSIGNED, unassign → IN_STOCK), rejecting any asset that can't make
    // the move (e.g. RETIRED). Per-asset events BEFORE the UPDATE.
    let target = if body.assigned_to_user_id.is_some() {
        "ASSIGNED"
    } else {
        "IN_STOCK"
    };
    let current_statuses: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT status FROM assets WHERE id = ANY($1)",
    )
    .bind(&body.ids)
    .fetch_all(&state.pool)
    .await?;
    for from in &current_statuses {
        if !can_transition(from, target) {
            return Err(transition_error(from, target));
        }
    }
    sqlx::query(
        "INSERT INTO asset_lifecycle_events (asset_id, from_status, to_status, actor_id, note) \
         SELECT id, status, $2, NULL, 'bulk assignment' FROM assets WHERE id = ANY($1) \
           AND status <> $2",
    )
    .bind(&body.ids)
    .bind(target)
    .execute(&state.pool)
    .await?;

    let result = sqlx::query(
        "UPDATE assets SET assigned_to_user_id = $2, status = $3, updated_at = NOW() \
         WHERE id = ANY($1)",
    )
    .bind(&body.ids)
    .bind(body.assigned_to_user_id)
    .bind(target)
    .execute(&state.pool)
    .await?;
    let updated = result.rows_affected() as i64;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_BULK_ASSIGN', 'asset', $1, $2)",
    )
    .bind(Uuid::new_v4())
    .bind(json!({ "count": updated, "assigned_to_user_id": body.assigned_to_user_id }))
    .execute(&state.pool)
    .await?;

    Ok(Json(BulkResult { updated }))
}

/// DELETE /api/v1/assets/bulk — {ids} → delete all matching assets.
/// FK safety: ci_relationships CASCADEs, tickets.asset_id SET NULLs.
async fn bulk_delete(
    State(state): State<AppState>,
    Json(body): Json<BulkIds>,
) -> Result<Json<BulkResult>, AppError> {
    validate_bulk_ids(&body.ids)?;

    let result = sqlx::query("DELETE FROM assets WHERE id = ANY($1)")
        .bind(&body.ids)
        .execute(&state.pool)
        .await?;
    let deleted = result.rows_affected() as i64;

    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES (NULL, 'ASSET_BULK_DELETE', 'asset', $1, $2)",
    )
    .bind(Uuid::new_v4())
    .bind(json!({ "count": deleted }))
    .execute(&state.pool)
    .await?;

    Ok(Json(BulkResult { updated: deleted }))
}
