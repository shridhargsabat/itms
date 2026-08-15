use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
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
        .route("/import", post(import_assets).layer(DefaultBodyLimit::max(10 * 1024 * 1024)))
        .route("/export", get(export_assets))
        .route("/bulk/status", patch(bulk_update_status))
        .route("/bulk/assign", patch(bulk_assign))
        .route("/bulk", delete(bulk_delete))
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
    if let Some(limit) = params.limit {
        qb.push(" LIMIT ").push_bind(limit.clamp(1, 1000));
        if let Some(offset) = params.offset {
            qb.push(" OFFSET ").push_bind(offset.max(0));
        }
    }

    let assets = qb.build_query_as::<Asset>().fetch_all(&state.pool).await?;
    let total: i64 = if params.limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        assets.len() as i64
    };
    Ok(([("x-total-count", total.to_string())], Json(assets)))
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
        errs.extend(e1.into_iter().chain(e2));

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
             assigned_to_user_id, specs, purchase_date, warranty_expiry) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) {ASSET_RETURNING}"
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
        if any {
            qb.push(" AND ");
        }
        qb.push("a.id = ANY(").push_bind(ids).push(")");
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
        "specs",
        "created_at",
    ])
    .map_err(csv_err)?;
    for a in &assets {
        wtr.write_record(vec![
            a.asset_tag.clone(),
            a.name.clone(),
            a.category.clone(),
            a.serial_number.clone(),
            a.status.clone(),
            a.assigned_user_name.clone().unwrap_or_default(),
            a.purchase_date.map(|d| d.to_string()).unwrap_or_default(),
            a.warranty_expiry.map(|d| d.to_string()).unwrap_or_default(),
            a.specs.to_string(),
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

    let result = sqlx::query(
        "UPDATE assets SET assigned_to_user_id = $2, updated_at = NOW() WHERE id = ANY($1)",
    )
    .bind(&body.ids)
    .bind(body.assigned_to_user_id)
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
