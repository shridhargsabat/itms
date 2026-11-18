//! /auth/* routes + the Bearer-token guard used on every protected route.

use axum::extract::{Extension, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// #95: constant-time login — unknown emails burn an argon2 verify against
/// this fixed hash so response latency doesn't leak account existence.
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$WJTsXQIWAJyDithOWz2n3A$FV4ZObbnkcR6pwM5YvRD/GyFpbxWT92CqB7KOs97lxg";
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{generate_token, hash_token, verify_password};
use crate::db::AppState;
use crate::routes::AppError;

pub const SESSION_TTL: &str = "7 days";

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
    pub theme: String,
}

/// POST /auth/login — verify credentials, mint an opaque session token.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = client_ip_public(&headers);
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, String, Option<String>, bool)>(
        "SELECT id, email, name, role, department, theme, password_hash, active FROM users WHERE email = $1",
    )
    .bind(body.email.trim().to_lowercase())
    .fetch_optional(&state.pool)
    .await?;

    let (id, email, name, role, department, theme, password_hash, active) = match row {
        Some(r) => r,
        None => {
            // #95: burn a full argon2 verify so unknown/known emails are
            // indistinguishable by latency; also count toward the rate bucket
            rate_limited_public(&state, &ip)?;
            let _ = verify_password(&body.password, DUMMY_HASH);
            return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid email or password"));
        }
    };
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
        // #86: count FAILED attempts per IP; 11th failure within 15 min → 429
        rate_limited_public(&state, &ip)?;
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid email or password"));
    }

    // correct credentials always pass and reset the IP bucket
    clear_rate_public(&state, &ip);

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
        "user": { "id": id, "email": email, "name": name, "role": role, "department": department, "theme": theme },
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

/// PUT /auth/theme — persist the caller's theme preference (theme manager).
/// Per-user: change it on one device, every device picks it up at next login
/// or /auth/me. Values validated server-side; no free-form strings.
#[derive(Deserialize)]
pub struct ThemeRequest {
    pub theme: String,
}

const VALID_THEMES: [&str; 10] = ["light", "dark", "ledgerly", "ledgerly-light", "system", "paper", "console", "bold", "shell", "terminal"];

fn is_valid_theme(t: &str) -> bool {
    VALID_THEMES.contains(&t)
}

pub async fn set_theme(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Json(body): Json<ThemeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let theme = body.theme.trim().to_lowercase();
    if !is_valid_theme(&theme) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "theme must be one of: light, dark, ledgerly, ledgerly-light, system, paper, console, bold, shell, terminal",
        ));
    }
    sqlx::query("UPDATE users SET theme = $1 WHERE id = $2")
        .bind(&theme)
        .bind(uid)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "ok": true, "theme": theme })))
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
        "SELECT u.id, u.email, u.name, u.role, u.department, u.theme
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE",
    )
    .bind(hash_token(&token))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "session expired or invalid"))
}


// ---- #86: per-IP rate limiting on public auth endpoints ----

const AUTH_RATE_MAX: usize = 10;
const AUTH_RATE_WINDOW_SECS: u64 = 900;

pub fn client_ip_public(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

pub fn rate_limited_public(state: &AppState, key: &str) -> Result<(), AppError> {
    let mut m = state.login_attempts.lock().unwrap();
    let now = std::time::Instant::now();
    let v = m.entry(key.to_string()).or_default();
    v.retain(|t| now.duration_since(*t).as_secs() < AUTH_RATE_WINDOW_SECS);
    if v.len() >= AUTH_RATE_MAX {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "too many login attempts — try again in 15 minutes",
        ));
    }
    v.push(now);
    Ok(())
}

pub fn clear_rate_public(state: &AppState, key: &str) {
    if let Ok(mut m) = state.login_attempts.lock() {
        m.remove(key);
    }
}

async fn issue_session(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(String, chrono::DateTime<chrono::Utc>), sqlx::Error> {
    let token = generate_token();
    let expires_at = sqlx::query_scalar(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + $3::interval)
         RETURNING expires_at",
    )
    .bind(user_id)
    .bind(hash_token(&token))
    .bind("7 days")
    .fetch_one(pool)
    .await?;
    Ok((token, expires_at))
}

// ---- #87: server-side demo login (no credentials in the JS bundle) ----

pub async fn demo_login(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = client_ip_public(&headers);
    rate_limited_public(&state, &format!("demo:{ip}"))?;
    let enabled = std::env::var("DEMO_LOGIN_ENABLED")
        .map(|v| v != "false")
        .unwrap_or(true);
    if !enabled {
        return Err(AppError::new(StatusCode::NOT_FOUND, "demo login disabled"));
    }
    let email = std::env::var("DEMO_LOGIN_EMAIL")
        .unwrap_or_else(|_| "demo@itms.local".into())
        .to_lowercase();
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, String, bool)>(
        "SELECT id, email, name, role, department, theme, active FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "demo login disabled"))?;
    let (id, email, name, role, department, theme, active) = row;
    if !active {
        return Err(AppError::new(StatusCode::NOT_FOUND, "demo login disabled"));
    }
    let (token, expires_at) = issue_session(&state.pool, id).await?;
    Ok(Json(serde_json::json!({
        "token": token,
        "expires_at": expires_at,
        "user": { "id": id, "email": email, "name": name, "role": role, "department": department, "theme": theme }
    })))
}

#[cfg(test)]
mod theme_tests {
    use super::is_valid_theme;
    #[test]
    fn allowlist_covers_all_ten_modes() {
        for t in ["light","dark","ledgerly","ledgerly-light","system","paper","console","bold","shell","terminal"] {
            assert!(is_valid_theme(t), "missing {t}");
        }
        assert!(!is_valid_theme("paper "));
        assert!(!is_valid_theme("DARK"));
        assert!(!is_valid_theme(""));
    }
}
