//! /auth/* routes + the Bearer-token guard used on every protected route.

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{generate_token, hash_token, verify_password};
use crate::db::AppState;
use crate::routes::AppError;

const SESSION_TTL: &str = "7 days";

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub department: String,
}

/// POST /auth/login — verify credentials, mint an opaque session token.
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, Option<String>, bool)>(
        "SELECT id, email, name, role, department, password_hash, active FROM users WHERE email = $1",
    )
    .bind(body.email.trim().to_lowercase())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "invalid email or password"))?;

    let (id, email, name, role, department, password_hash, active) = row;
    if !active {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "account disabled — contact your administrator",
        ));
    }
    let valid = password_hash
        .as_deref()
        .map(|h| verify_password(&body.password, h))
        .unwrap_or(false);
    if !valid {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid email or password"));
    }

    let token = generate_token();
    let expires_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + $3::interval)
         RETURNING expires_at",
    )
    .bind(id)
    .bind(hash_token(&token))
    .bind(SESSION_TTL)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(json!({
        "token": token,
        "expires_at": expires_at,
        "user": { "id": id, "email": email, "name": name, "role": role, "department": department },
    })))
}

/// POST /auth/logout — revoke the presented token (server-side, real logout).
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = bearer_token(&headers)?;
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(hash_token(&token))
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// GET /auth/me — current session user.
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthUser>, AppError> {
    Ok(Json(current_user(&state.pool, &headers).await?))
}

/// Axum middleware: 401 unless a valid Bearer session is presented.
/// Inserts the authenticated user's id + role into request extensions so
/// downstream handlers/middleware can enforce RBAC.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user = current_user(&state.pool, req.headers()).await?;
    req.extensions_mut().insert(user.id);
    req.extensions_mut().insert(user.role);
    Ok(next.run(req).await)
}

/// RBAC: 403 unless the authenticated user is an ADMIN. Must run inside
/// `require_auth` (the role extension is populated there).
pub async fn require_admin(req: Request, next: Next) -> Result<Response, AppError> {
    let role = req
        .extensions()
        .get::<String>()
        .map(|r| r.as_str())
        .unwrap_or("");
    if role != "ADMIN" {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "admin role required",
        ));
    }
    Ok(next.run(req).await)
}

fn bearer_token(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "authentication required"))?;
    let token = value
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "authentication required"))?;
    if token.is_empty() {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "authentication required"));
    }
    Ok(token.to_string())
}

async fn current_user(pool: &PgPool, headers: &HeaderMap) -> Result<AuthUser, AppError> {
    let token = bearer_token(headers)?;
    sqlx::query_as::<_, AuthUser>(
        "SELECT u.id, u.email, u.name, u.role, u.department
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE",
    )
    .bind(hash_token(&token))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "session expired or invalid"))
}
