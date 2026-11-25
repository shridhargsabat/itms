// #46: named ticket templates — prefill type/priority/description for standard
// intakes (new-hire setup, printer issue, access request). Staff create/edit,
// admin deletes; all authed users can list (requesters pick when creating).

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::AppState;
use crate::routes::AppError;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TicketTemplate {
    pub id: Uuid,
    pub name: String,
    pub ticket_type: String,
    pub priority: String,
    pub description: String,
    pub active: bool,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    #[sqlx(default)]
    pub created_by_name: Option<String>,
}

fn require_staff(role: &str) -> Result<(), AppError> {
    // TBE-27: strict allowlist via is_staff_role — the old `role == "EMPLOYEE"`
    // check failed OPEN for any unexpected role value.
    if !super::auth::is_staff_role(role) {
        return Err(AppError::new(StatusCode::FORBIDDEN, "agents and admins only"));
    }
    Ok(())
}

/// R2-BE-09 (#142): UNIQUE(name) → 409 (was 500); creator/updater FK race →
/// 422 (TBE-26 pattern). Never 500 for either.
fn map_template_write_error(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &err {
        if db.code().as_deref() == Some("23505") {
            return AppError::new(StatusCode::CONFLICT, "template name already exists");
        }
        let is_fk = db.code().as_deref() == Some("23503")
            || db.constraint().is_some_and(|c| c.contains("fkey"));
        if is_fk {
            return AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "author no longer exists");
        }
    }
    AppError::from(err)
}

// GET /templates?active_only=1
#[derive(Deserialize)]
pub struct TemplateListQuery {
    pub active_only: Option<String>,
}

/// GET /templates — all ticket templates.
/// Intentionally unpaginated: small master data, fetched whole.
pub async fn list_templates(
    State(state): State<AppState>,
    Query(q): Query<TemplateListQuery>,
) -> Result<Json<Vec<TicketTemplate>>, AppError> {
    let rows = sqlx::query_as::<_, TicketTemplate>(
        "SELECT t.id, t.name, \
                CASE WHEN t.ticket_type = 'REQUEST' THEN 'SERVICE_REQUEST' ELSE t.ticket_type END AS ticket_type, \
                t.priority, t.description, t.active, \
                t.created_by, t.updated_by, t.created_at, t.updated_at, \
                cu.name AS created_by_name \
         FROM ticket_templates t \
         LEFT JOIN users cu ON cu.id = t.created_by \
         WHERE $1::boolean = FALSE OR t.active = TRUE \
         ORDER BY t.name",
    )
    .bind(q.active_only.as_deref() == Some("1"))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

// POST /templates
#[derive(Deserialize)]
pub struct CreateTemplateRequest {
    pub name: String,
    pub ticket_type: Option<String>,
    pub priority: Option<String>,
    pub description: Option<String>,
}

pub async fn create_template(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<CreateTemplateRequest>,
) -> Result<(StatusCode, Json<TicketTemplate>), AppError> {
    require_staff(&role)?;
    if body.name.trim().is_empty() {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "name is required"));
    }
    // R2-BE-09 (#142): strict allowlists (were: uppercase-only type, verbatim
    // priority — garbage sailed into the table). Same validators + 422s as
    // the ticket handlers.
    let ticket_type = super::tickets::validate_ticket_type(body.ticket_type.as_deref())?;
    let priority = match body.priority.as_deref() {
        None => "MEDIUM".to_string(),
        Some(p) => super::tickets::validate_priority(p)?,
    };
    let name = body.name.trim().to_string();
    let description = body.description.as_deref().unwrap_or("").trim().to_string();
    // R2-BE-09 (#142): template + audit in one tx — a failed audit write no
    // longer leaves a template with no creation record.
    let mut tx = state.pool.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO ticket_templates (name, ticket_type, priority, description, created_by, updated_by) \
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id",
    )
    .bind(&name)
    .bind(&ticket_type)
    .bind(&priority)
    .bind(&description)
    .bind(uid)
    .fetch_one(&mut *tx)
    .await
    .map_err(map_template_write_error)?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TEMPLATE_CREATED', 'ticket_template', $2, $3)",
    )
    .bind(uid)
    .bind(id)
    .bind(serde_json::json!({"name": name}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(fetch_one(&state.pool, id).await?),
    ))
}

// PUT /templates/{id}
#[derive(Deserialize)]
pub struct UpdateTemplateRequest {
    pub name: Option<String>,
    pub ticket_type: Option<String>,
    pub priority: Option<String>,
    pub description: Option<String>,
    pub active: Option<bool>,
}

pub async fn update_template(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTemplateRequest>,
) -> Result<Json<TicketTemplate>, AppError> {
    require_staff(&role)?;
    // R2-BE-09 (#142): validate supplied fields before touching the row —
    // empty names rejected (were: silently stored), garbage type/priority
    // rejected (were: stored verbatim / uppercased-only).
    if body.name.as_deref().is_some_and(|n| n.trim().is_empty()) {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "name is required"));
    }
    let new_name = body.name.as_deref().map(|n| n.trim().to_string());
    let new_type = body
        .ticket_type
        .as_deref()
        .map(|t| super::tickets::validate_ticket_type(Some(t)))
        .transpose()?;
    let new_priority = body.priority.as_deref().map(super::tickets::validate_priority).transpose()?;
    let new_desc = body.description.as_deref().map(|d| d.trim().to_string());
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, String, String, String, bool)> = sqlx::query_as(
        "SELECT name, ticket_type, priority, description, active FROM ticket_templates WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((name, tt, prio, desc, act)) = current else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "template not found"));
    };
    sqlx::query(
        "UPDATE ticket_templates SET name = $2, ticket_type = $3, priority = $4, \
         description = $5, active = $6, updated_by = $7, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(new_name.unwrap_or(name))
    .bind(new_type.unwrap_or(tt))
    .bind(new_priority.unwrap_or(prio))
    .bind(new_desc.unwrap_or(desc))
    .bind(body.active.unwrap_or(act))
    .bind(uid)
    .execute(&mut *tx)
    .await
    .map_err(map_template_write_error)?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TEMPLATE_UPDATED', 'ticket_template', $2, '{}')",
    )
    .bind(uid)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(fetch_one(&state.pool, id).await?))
}

// DELETE /templates/{id} (admin only)
pub async fn delete_template(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admins only"));
    }
    // R2-BE-09 (#142): delete + audit in one tx, like create/update.
    let mut tx = state.pool.begin().await?;
    let res = sqlx::query("DELETE FROM ticket_templates WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::new(StatusCode::NOT_FOUND, "template not found"));
    }
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TEMPLATE_DELETED', 'ticket_template', $2, '{}')",
    )
    .bind(uid)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_one(pool: &PgPool, id: Uuid) -> Result<TicketTemplate, AppError> {
    Ok(sqlx::query_as::<_, TicketTemplate>(
        "SELECT t.id, t.name, \
                CASE WHEN t.ticket_type = 'REQUEST' THEN 'SERVICE_REQUEST' ELSE t.ticket_type END AS ticket_type, \
                t.priority, t.description, t.active, \
                t.created_by, t.updated_by, t.created_at, t.updated_at, \
                cu.name AS created_by_name \
         FROM ticket_templates t \
         LEFT JOIN users cu ON cu.id = t.created_by \
         WHERE t.id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_templates).post(create_template))
        .route("/{id}", put(update_template).delete(delete_template))
}

use axum::extract::Query;
use axum::routing::{get, put};
use axum::Router;

/// R2 P2 regression tests (issue #142 R2-BE-09): DB-backed handler tests.
/// Same TEST_DATABASE_URL-with-skip pattern as
/// routes::intake::r2_regression_tests — when no test DB is reachable they
/// skip (pass with a notice) so `cargo test` stays green without a database.
#[cfg(test)]
mod r2_p2_regression_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    const DEFAULT_TEST_DB_URL: &str = "postgres://itms_test:itms_test@127.0.0.1:55434/itms_test";

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DB_URL.to_string());
        match PgPoolOptions::new().max_connections(5).connect(&url).await {
            Ok(pool) => {
                sqlx::migrate!("./migrations")
                    .run(&pool)
                    .await
                    .expect("test DB migrations must apply");
                Some(pool)
            }
            Err(e) => {
                eprintln!("r2_p2_regression_tests(templates): skipping — no test DB at {url} ({e})");
                None
            }
        }
    }

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState { pool, login_attempts: Default::default(), opencode_api_key: None }
    }

    async fn create_staff(pool: &sqlx::PgPool) -> Uuid {
        let email = format!("r2p2-t-{}@example.com", Uuid::new_v4().simple());
        sqlx::query_scalar(
            "INSERT INTO users (name, email, role, department, password_hash, active) \
             VALUES ('R2P2 Templates', $1, 'AGENT', 'IT', 'test-hash', TRUE) RETURNING id",
        )
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn unique_name(tag: &str) -> String {
        format!("r2p2-{tag}-{}", Uuid::new_v4().simple())
    }

    fn create_req(name: &str, tt: Option<&str>, prio: Option<&str>) -> Json<CreateTemplateRequest> {
        Json(CreateTemplateRequest {
            name: name.to_string(),
            ticket_type: tt.map(str::to_string),
            priority: prio.map(str::to_string),
            description: None,
        })
    }

    #[tokio::test]
    async fn create_rejects_garbage_ticket_type_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let err = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&unique_name("badtype"), Some("GARBAGE"), None),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("invalid ticket_type"), "message: {}", err.message);
    }

    #[tokio::test]
    async fn create_rejects_garbage_priority_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let err = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&unique_name("badprio"), None, Some("CRITICAL")),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("invalid priority"), "message: {}", err.message);
    }

    #[tokio::test]
    async fn create_duplicate_name_returns_409_without_audit_orphan() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let name = unique_name("dupe");

        let (code, _) = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&name, None, None),
        )
        .await
        .unwrap();
        assert_eq!(code, StatusCode::CREATED);

        let err = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&name, None, None),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::CONFLICT);
        assert!(err.message.contains("already exists"), "message: {}", err.message);

        // Still exactly one row — and the failed insert wrote no audit row
        // (template + audit commit atomically).
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_templates WHERE name = $1")
            .bind(&name)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(1, n);
        let audits: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'TEMPLATE_CREATED' AND diff->>'name' = $1",
        )
        .bind(&name)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(1, audits);
    }

    #[tokio::test]
    async fn create_normalizes_case_and_legacy_values() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let (_, Json(t)) = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&unique_name("norm"), Some("request"), Some("high")),
        )
        .await
        .unwrap();
        assert_eq!(t.ticket_type, "SERVICE_REQUEST");
        assert_eq!(t.priority, "HIGH");
    }

    #[tokio::test]
    async fn update_rejects_empty_name_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let name = unique_name("emptyupd");
        let (_, Json(t)) = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&name, None, None),
        )
        .await
        .unwrap();

        let err = update_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            Path(t.id),
            Json(UpdateTemplateRequest {
                name: Some("   ".to_string()),
                ticket_type: None,
                priority: None,
                description: None,
                active: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);

        let stored: String = sqlx::query_scalar("SELECT name FROM ticket_templates WHERE id = $1")
            .bind(t.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, name);
    }

    #[tokio::test]
    async fn update_rejects_garbage_type_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let (_, Json(t)) = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&unique_name("updbadtype"), None, None),
        )
        .await
        .unwrap();

        let err = update_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            Path(t.id),
            Json(UpdateTemplateRequest {
                name: None,
                ticket_type: Some("NOPE".to_string()),
                priority: None,
                description: None,
                active: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("invalid ticket_type"), "message: {}", err.message);
    }

    #[tokio::test]
    async fn update_rejects_garbage_priority_422() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let (_, Json(t)) = create_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            create_req(&unique_name("updbadprio"), None, None),
        )
        .await
        .unwrap();

        let err = update_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            Path(t.id),
            Json(UpdateTemplateRequest {
                name: None,
                ticket_type: None,
                priority: Some("whenever".to_string()),
                description: None,
                active: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("invalid priority"), "message: {}", err.message);
    }

    #[tokio::test]
    async fn update_duplicate_name_returns_409() {
        let Some(pool) = test_pool().await else { return };
        let staff = create_staff(&pool).await;
        let name_a = unique_name("upddupe-a");
        let name_b = unique_name("upddupe-b");
        for n in [&name_a, &name_b] {
            create_template(
                State(test_state(pool.clone())),
                Extension(staff),
                Extension("AGENT".to_string()),
                create_req(n, None, None),
            )
            .await
            .map(|_| ())
            .unwrap();
        }
        let id_b: Uuid = sqlx::query_scalar("SELECT id FROM ticket_templates WHERE name = $1")
            .bind(&name_b)
            .fetch_one(&pool)
            .await
            .unwrap();

        let err = update_template(
            State(test_state(pool.clone())),
            Extension(staff),
            Extension("AGENT".to_string()),
            Path(id_b),
            Json(UpdateTemplateRequest {
                name: Some(name_a.clone()),
                ticket_type: None,
                priority: None,
                description: None,
                active: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, StatusCode::CONFLICT);

        let stored: String = sqlx::query_scalar("SELECT name FROM ticket_templates WHERE id = $1")
            .bind(id_b)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, name_b);
    }
}
