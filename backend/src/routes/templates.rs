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
    if role == "EMPLOYEE" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "agents and admins only"));
    }
    Ok(())
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
        "SELECT t.id, t.name, t.ticket_type, t.priority, t.description, t.active, \
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
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO ticket_templates (name, ticket_type, priority, description, created_by, updated_by) \
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id",
    )
    .bind(body.name.trim())
    .bind(body.ticket_type.unwrap_or_else(|| "INCIDENT".into()))
    .bind(body.priority.unwrap_or_else(|| "MEDIUM".into()))
    .bind(body.description.unwrap_or_default().trim())
    .bind(uid)
    .fetch_one(&state.pool)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TEMPLATE_CREATED', 'ticket_template', $2, $3)",
    )
    .bind(uid)
    .bind(id)
    .bind(serde_json::json!({"name": body.name.trim()}))
    .execute(&state.pool)
    .await?;
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
    let current: Option<(String, String, String, String, bool)> = sqlx::query_as(
        "SELECT name, ticket_type, priority, description, active FROM ticket_templates WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((name, tt, prio, desc, act)) = current else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "template not found"));
    };
    sqlx::query(
        "UPDATE ticket_templates SET name = $2, ticket_type = $3, priority = $4, \
         description = $5, active = $6, updated_by = $7, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(body.name.map(|s| s.trim().to_string()).unwrap_or(name))
    .bind(body.ticket_type.unwrap_or(tt))
    .bind(body.priority.unwrap_or(prio))
    .bind(body.description.map(|s| s.trim().to_string()).unwrap_or(desc))
    .bind(body.active.unwrap_or(act))
    .bind(uid)
    .execute(&state.pool)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'TEMPLATE_UPDATED', 'ticket_template', $2, '{}')",
    )
    .bind(uid)
    .bind(id)
    .execute(&state.pool)
    .await?;
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
    let res = sqlx::query("DELETE FROM ticket_templates WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
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
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_one(pool: &PgPool, id: Uuid) -> Result<TicketTemplate, AppError> {
    Ok(sqlx::query_as::<_, TicketTemplate>(
        "SELECT t.id, t.name, t.ticket_type, t.priority, t.description, t.active, \
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
use axum::routing::{get, post, put};
use axum::Router;
