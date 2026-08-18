//! Users master: list/search, create, update (incl. soft-disable + password).
//! GET is open to any authenticated user (assignee dropdowns need it);
//! POST/PATCH are ADMIN-only (enforced by route_layer(require_admin)).

use axum::extract::{Extension, Path, Query, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::hash_password;
use crate::db::AppState;
use crate::routes::AppError;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub department: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub search: Option<String>,
    pub role: Option<String>,
    pub department: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

/// Whitelisted ORDER BY columns.
fn user_sort(col: &str) -> &'static str {
    match col {
        "email" => "email",
        "role" => "role",
        "department" => "department",
        "created_at" => "created_at",
        _ => "name",
    }
}

#[derive(Deserialize)]
pub struct CreateUser {
    pub email: String,
    pub name: String,
    pub role: Option<String>,
    pub department: Option<String>,
    pub password: String,
}

#[derive(Deserialize)]
pub struct UpdateUser {
    pub email: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
    pub department: Option<String>,
    pub active: Option<bool>,
    pub password: Option<String>,
}

pub fn router() -> Router<AppState> {
    // Reads (list) are open to any authenticated user — assignee dropdowns
    // and option lists depend on them. Mutations are ADMIN-only.
    Router::new()
        .route("/", get(list_users))
        .merge(
            Router::new()
                .route("/", post(create_user))
                .route("/{id}", patch(update_user))
                .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin)),
        )
}

async fn list_users(
    State(state): State<AppState>,
    Query(q): Query<ListParams>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut qb = sqlx::QueryBuilder::new(
        "SELECT id, email, name, role, department, active, created_at FROM users WHERE 1=1",
    );
    // Count query mirrors the SAME filter pushes (same bind order).
    let mut cqb = sqlx::QueryBuilder::new("SELECT COUNT(*) FROM users WHERE 1=1");
    if let Some(search) = q.search.filter(|s| !s.trim().is_empty()) {
        let like = format!("%{}%", search.trim());
        qb.push(" AND (name ILIKE ")
            .push_bind(like.clone())
            .push(" OR email ILIKE ")
            .push_bind(like.clone())
            .push(")");
        cqb.push(" AND (name ILIKE ")
            .push_bind(like.clone())
            .push(" OR email ILIKE ")
            .push_bind(like.clone())
            .push(")");
    }
    if let Some(role) = q.role.filter(|r| !r.is_empty()) {
        qb.push(" AND role = ").push_bind(role.clone());
        cqb.push(" AND role = ").push_bind(role.clone());
    }
    if let Some(dept) = q.department.filter(|d| !d.is_empty()) {
        qb.push(" AND department = ").push_bind(dept.clone());
        cqb.push(" AND department = ").push_bind(dept.clone());
    }
    qb.push(" ORDER BY ").push(user_sort(q.sort.as_deref().unwrap_or("name")));
    if q.order.as_deref() == Some("desc") {
        qb.push(" DESC");
    } else {
        qb.push(" ASC");
    }
    qb.push(", name ASC");
    // Optional pagination (client lists default to unlimited for now).
    let (limit, offset) = crate::pagination::page_params(q.limit, q.offset);
    crate::pagination::push_pagination(&mut qb, limit, offset);
    let users = qb.build_query_as::<UserRow>().fetch_all(&state.pool).await?;
    let total: i64 = if limit.is_some() {
        cqb.build_query_scalar().fetch_one(&state.pool).await?
    } else {
        users.len() as i64
    };
    Ok((crate::pagination::total_header(total), Json(users)))
}

async fn create_user(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateUser>,
) -> Result<(axum::http::StatusCode, Json<UserRow>), AppError> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') || body.name.trim().is_empty() {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "valid email and name required",
        ));
    }
    let role = body.role.unwrap_or_else(|| "EMPLOYEE".to_string());
    if !["ADMIN", "AGENT", "EMPLOYEE"].contains(&role.as_str()) {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "role must be ADMIN, AGENT or EMPLOYEE",
        ));
    }
    if body.password.len() < 8 {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        ));
    }
    let department = body.department.unwrap_or_else(|| "IT".to_string());
    let password_hash = hash_password(&body.password).map_err(|_| {
        AppError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "password hashing failed",
        )
    })?;

    let row = sqlx::query_as::<_, UserRow>(
        "INSERT INTO users (email, name, role, department, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, department, active, created_at",
    )
    .bind(&email)
    .bind(body.name.trim())
    .bind(&role)
    .bind(&department)
    .bind(&password_hash)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => AppError::new(
            axum::http::StatusCode::CONFLICT,
            "email already exists",
        ),
        other => AppError::from(other),
    })?;

    crate::audit::write(
        &state.pool,
        Some(actor_id),
        "USER_CREATE",
        "user",
        row.id,
        json!({ "old": {}, "new": { "email": row.email, "name": row.name, "role": row.role, "department": row.department } }),
    )
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(row)))
}

async fn update_user(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateUser>,
) -> Result<Json<UserRow>, AppError> {
    let existing = sqlx::query_as::<_, UserRow>(
        "SELECT id, email, name, role, department, active, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("user not found"))?;

    if existing.email == "admin@itms.local" && body.active == Some(false) {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "cannot disable the seed admin",
        ));
    }

    let password_hash = match body.password {
        Some(ref pw) if pw.len() >= 8 => Some(
            hash_password(pw).map_err(|_| {
                AppError::new(
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "password hashing failed",
                )
            })?,
        ),
        Some(_) => {
            return Err(AppError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "password must be at least 8 characters",
            ))
        }
        None => None,
    };

    let row = sqlx::query_as::<_, UserRow>(
        "UPDATE users SET
            email = COALESCE($1, email),
            name = COALESCE($2, name),
            role = COALESCE($3, role),
            department = COALESCE($4, department),
            active = COALESCE($5, active),
            password_hash = COALESCE($6, password_hash)
         WHERE id = $7
         RETURNING id, email, name, role, department, active, created_at",
    )
    .bind(body.email.as_deref().map(str::trim))
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.role.as_deref())
    .bind(body.department.as_deref())
    .bind(body.active)
    .bind(password_hash)
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => AppError::new(
            axum::http::StatusCode::CONFLICT,
            "email already exists",
        ),
        other => AppError::from(other),
    })?
    .ok_or_else(|| AppError::not_found("user not found"))?;

    let mut new = serde_json::Map::new();
    new.insert("email".into(), json!(row.email));
    new.insert("name".into(), json!(row.name));
    new.insert("role".into(), json!(row.role));
    new.insert("department".into(), json!(row.department));
    new.insert("active".into(), json!(row.active));
    if body.password.is_some() {
        new.insert("password_changed".into(), json!(true));
    }
    crate::audit::write(
        &state.pool,
        Some(actor_id),
        "USER_UPDATE",
        "user",
        row.id,
        json!({
            "old": { "email": existing.email, "name": existing.name, "role": existing.role, "department": existing.department, "active": existing.active },
            "new": new
        }),
    )
    .await?;

    Ok(Json(row))
}

/// Small helper so tests can fetch a user's role without a session roundtrip.
#[allow(dead_code)]
pub async fn role_of(pool: &PgPool, id: Uuid) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT role FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}
