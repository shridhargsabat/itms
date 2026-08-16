// P1-6 (issue #47): password reset flow.
// forgot-password is intentionally always-successful (no account enumeration).
// The reset link travels BOTH channels: pending_emails (fires once SMTP is
// configured) and an in-app notification (works today, no SMTP needed).

use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{generate_token, hash_token, verify_password};
use crate::db::AppState;
use crate::routes::AppError;

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

const RESET_TTL_MINUTES: i64 = 30;

fn validate_password(pw: &str) -> Result<(), AppError> {
    if pw.len() < 8 {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "password must be at least 8 characters",
        ));
    }
    Ok(())
}

/// POST /auth/forgot-password — always 200 (no enumeration).
pub async fn forgot_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // #86: shared per-IP bucket with login (separate key so a forgot-password
    // storm can't lock the account out of login itself)
    let ip = crate::routes::auth::client_ip_public(&headers);
    crate::routes::auth::rate_limited_public(&state, &format!("fp:{ip}"))?;
    let email = body.email.trim().to_lowercase();
    let user: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE email = $1 AND active = TRUE")
            .bind(&email)
            .fetch_optional(&state.pool)
            .await?;

    if let Some((uid,)) = user {
        let raw = generate_token();
        let token_hash = hash_token(&raw);
        sqlx::query(
            "INSERT INTO password_resets (user_id, token_hash, expires_at) \
             VALUES ($1, $2, NOW() + $3 * INTERVAL '1 minute')",
        )
        .bind(uid)
        .bind(&token_hash)
        .bind(RESET_TTL_MINUTES)
        .execute(&state.pool)
        .await?;

        let link = format!(
            "https://itms.ai-automation-hub.tech/reset-password?token={raw}"
        );
        let body = format!(
            "A password reset was requested for your ITMS account.\n\
             Reset link (expires in {RESET_TTL_MINUTES} minutes):\n{link}\n\n\
             If you did not request this, ignore this message."
        );
        crate::routes::notifications::notify(
            &state.pool,
            uid,
            "PASSWORD_RESET",
            "Password reset requested",
            &body,
            "user",
            uid,
        )
        .await;
        sqlx::query(
            "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
             VALUES ($1, 'PASSWORD_RESET_REQUESTED', 'user', $2, '{\"via\":\"forgot-password\"}')",
        )
        .bind(uid)
        .bind(uid)
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(json!({"ok": true})))
}

/// POST /auth/reset-password — token is single-use, 30-minute TTL.
pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_password(&body.new_password)?;
    let token_hash = hash_token(body.token.trim());

    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM password_resets \
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?;

    let Some((uid,)) = row else {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reset token invalid or expired",
        ));
    };

    let new_hash = crate::auth::hash_password(&body.new_password)
        .map_err(|_| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "hash failed"))?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(uid)
        .bind(&new_hash)
        .execute(&state.pool)
        .await?;
    sqlx::query("UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1")
        .bind(&token_hash)
        .execute(&state.pool)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'PASSWORD_RESET_COMPLETED', 'user', $2, '{\"via\":\"reset-token\"}')",
    )
    .bind(uid)
    .bind(uid)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({"ok": true})))
}

/// POST /auth/change-password — authenticated user changes their own password.
pub async fn change_password(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_password(&body.new_password)?;
    let hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(uid)
            .fetch_optional(&state.pool)
            .await?;
    let Some(hash) = hash else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "user not found"));
    };
    if !verify_password(&body.current_password, &hash) {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "current password is incorrect",
        ));
    }
    let new_hash = crate::auth::hash_password(&body.new_password)
        .map_err(|_| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "hash failed"))?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(uid)
        .bind(&new_hash)
        .execute(&state.pool)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'PASSWORD_CHANGED', 'user', $2, '{\"via\":\"self-service\"}')",
    )
    .bind(uid)
    .bind(uid)
    .execute(&state.pool)
    .await?;
    Ok(Json(json!({"ok": true})))
}
