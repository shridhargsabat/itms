// #53: Google SSO — admin-configurable OAuth 2.0 with account linking.
//
// The admin configures client_id / client_secret / allowed_domains from the
// Settings UI (PUT /admin/oauth). The flow is disabled until `enabled=true`.
//
//   /auth/oauth/status   (public)  → { enabled, client_id_set }
//   /auth/oauth/start    (public)  → 302 to Google consent
//   /auth/oauth/callback (public)  → exchange → link → issue session → 302 SPA
//   /admin/oauth         (admin)   → GET masked config / PUT update
//
// Security defaults: NO auto-provisioning (SSO only links to existing
// accounts — email must match a users row), optional domain allowlist
// (empty = any existing user, best used with a non-empty allowlist),
// one-time 10-min state nonces, email_verified required.
//
// Test-only env overrides (never set in prod): GOOGLE_OAUTH_TOKEN_URL and
// GOOGLE_OAUTH_USERINFO_URL let local verification run a mock IdP.

use axum::extract::{Extension, Query, State};
use axum::http::{header, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{generate_token, hash_token};
use super::auth::SESSION_TTL;
use super::AppError;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const STATE_TTL_MINUTES: i64 = 10;

#[derive(Debug, Serialize, sqlx::FromRow)]
struct OAuthConfigRow {
    enabled: bool,
    client_id: String,
    client_secret: String,
    allowed_domains: Vec<String>,
}

async fn load_config(pool: &PgPool) -> Result<OAuthConfigRow, AppError> {
    sqlx::query_as::<_, OAuthConfigRow>(
        "SELECT enabled, client_id, client_secret, allowed_domains FROM oauth_config WHERE id = true",
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Public flow
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct OAuthStatus {
    pub enabled: bool,
    pub provider: &'static str,
    pub client_id_set: bool,
}

/// GET /auth/oauth/status — the login page calls this to show the button.
pub async fn status(State(state): State<super::AppState>) -> Result<Json<OAuthStatus>, AppError> {
    let cfg = load_config(&state.pool).await?;
    Ok(Json(OAuthStatus {
        enabled: cfg.enabled,
        provider: "google",
        client_id_set: !cfg.client_id.trim().is_empty(),
    }))
}

fn base_url(headers: &axum::http::HeaderMap) -> String {
    // Traefik (prod) always sends x-forwarded-proto; absent → assume plain
    // http (local dev / direct backend access).
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    format!("{scheme}://{host}")
}

/// GET /auth/oauth/start — build the Google consent URL and 302 to it.
pub async fn start(
    State(state): State<super::AppState>,
    headers: axum::http::HeaderMap,
) -> Result<axum::response::Redirect, AppError> {
    let cfg = load_config(&state.pool).await?;
    if !cfg.enabled || cfg.client_id.trim().is_empty() {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Google SSO is not enabled — ask an administrator to configure it in Settings",
        ));
    }

    let state_nonce = generate_state();
    sqlx::query("INSERT INTO oauth_states (state) VALUES ($1)")
        .bind(&state_nonce)
        .execute(&state.pool)
        .await?;
    // housekeeping: drop expired nonces
    sqlx::query("DELETE FROM oauth_states WHERE created_at < NOW() - make_interval(mins => $1::int)")
        .bind(STATE_TTL_MINUTES)
        .execute(&state.pool)
        .await?;

    let redirect_uri = format!("{}/api/v1/auth/oauth/callback", base_url(&headers));
    let auth_url = std::env::var("GOOGLE_OAUTH_AUTH_URL").unwrap_or_else(|_| GOOGLE_AUTH_URL.to_string());
    let url = format!(
        "{auth_url}?client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&state={}&prompt=select_account",
        urlencode(&cfg.client_id),
        urlencode(&redirect_uri),
        urlencode(&state_nonce),
    );
    Ok(axum::response::Redirect::temporary(&url))
}

fn generate_state() -> String {
    use rand::RngCore;
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Debug, Deserialize)]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    email: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
}

/// GET /auth/oauth/callback — exchange code, link to an existing account,
/// issue a session, then 302 to the SPA with the token in the query string.
pub async fn callback(
    State(state): State<super::AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Result<axum::response::Redirect, AppError> {
    let base = base_url(&headers);
    if let Some(err) = &params.error {
        return Ok(axum::response::Redirect::temporary(&format!(
            "{base}/login?error=sso_{err}"
        )));
    }
    let (code, state_nonce) = match (params.code, params.state) {
        (Some(c), Some(s)) => (c, s),
        _ => {
            return Err(AppError::new(
                StatusCode::BAD_REQUEST,
                "missing code or state in OAuth callback",
            ))
        }
    };

    // one-time state nonce
    let consumed = sqlx::query("DELETE FROM oauth_states WHERE state = $1")
        .bind(&state_nonce)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if consumed == 0 {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "invalid or expired OAuth state"));
    }

    let cfg = load_config(&state.pool).await?;
    if !cfg.enabled || cfg.client_id.trim().is_empty() {
        return Err(AppError::new(StatusCode::CONFLICT, "Google SSO is not enabled"));
    }

    let redirect_uri = format!("{base}/api/v1/auth/oauth/callback");
    let token_url = std::env::var("GOOGLE_OAUTH_TOKEN_URL").unwrap_or_else(|_| GOOGLE_TOKEN_URL.to_string());
    let userinfo_url =
        std::env::var("GOOGLE_OAUTH_USERINFO_URL").unwrap_or_else(|_| GOOGLE_USERINFO_URL.to_string());

    // exchange the authorization code
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("http client: {e}")))?;
    let token_resp: TokenResponse = client
        .post(&token_url)
        .form(&[
            ("code", code.as_str()),
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("token exchange failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("token exchange rejected: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("token response parse: {e}")))?;

    // fetch the verified profile
    let info: UserInfo = client
        .get(&userinfo_url)
        .bearer_auth(&token_resp.access_token)
        .send()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("userinfo failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("userinfo rejected: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("userinfo parse: {e}")))?;

    let email = info
        .email
        .ok_or_else(|| AppError::new(StatusCode::BAD_GATEWAY, "Google did not return an email"))?;
    if info.email_verified != Some(true) {
        return Err(AppError::new(StatusCode::FORBIDDEN, "Google email is not verified"));
    }
    let email = email.trim().to_lowercase();

    // domain allowlist (default-DENY posture: if configured, must match)
    if !cfg.allowed_domains.is_empty() {
        let domain = email.rsplit('@').next().unwrap_or("");
        if !cfg.allowed_domains.iter().any(|d| d.eq_ignore_ascii_case(domain)) {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                "email domain is not allowed for SSO",
            ));
        }
    }

    // account linking: only existing, active users
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, bool)>(
        "SELECT id, email, name, role, department, active FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    let (id, _, name, role, department, active) = match row {
        Some(r) => r,
        None => {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                "no ITMS account linked to this Google email — ask an administrator to create one",
            ))
        }
    };
    if !active {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "account disabled — contact your administrator",
        ));
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

    // SPA route reads the query, stores the session, navigates home.
    let dest = format!(
        "{base}/oauth/callback?token={}&expires_at={}&user={}",
        token,
        expires_at.to_rfc3339(),
        urlencode(&format!("{role}|{name}|{department}|{id}|{email}")),
    );
    Ok(axum::response::Redirect::temporary(&dest))
}

// ---------------------------------------------------------------------------
// Admin configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct OAuthConfigView {
    pub provider: &'static str,
    pub enabled: bool,
    pub client_id: String,
    pub has_secret: bool,
    pub allowed_domains: Vec<String>,
}

/// GET /admin/oauth — masked view (secret never leaves the server).
pub async fn admin_get(State(state): State<super::AppState>) -> Result<Json<OAuthConfigView>, AppError> {
    let cfg = load_config(&state.pool).await?;
    Ok(Json(OAuthConfigView {
        provider: "google",
        enabled: cfg.enabled,
        client_id: cfg.client_id,
        has_secret: !cfg.client_secret.trim().is_empty(),
        allowed_domains: cfg.allowed_domains,
    }))
}

#[derive(Debug, Deserialize)]
pub struct OAuthConfigUpdate {
    pub enabled: Option<bool>,
    pub client_id: Option<String>,
    /// Empty/absent = keep the existing secret. Set a new one to rotate.
    pub client_secret: Option<String>,
    pub allowed_domains: Option<Vec<String>>,
}

/// PUT /admin/oauth — admin-only, in-handler role check (route pattern).
pub async fn admin_put(
    State(state): State<super::AppState>,
    Extension(role): Extension<String>,
    Json(body): Json<OAuthConfigUpdate>,
) -> Result<Json<OAuthConfigView>, AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admin only"));
    }
    let mut q = String::from("UPDATE oauth_config SET ");
    let mut binds: Vec<String> = Vec::new();
    macro_rules! set {
        ($col:expr, $v:expr, $cast:expr) => {{
            let v = $v;
            if v.is_some() {
                if !binds.is_empty() {
                    q.push_str(", ");
                }
                q.push_str(&format!("{} = ${}{}", $col, binds.len() + 1, $cast));
                binds.push(v.unwrap());
            }
        }};
    }
    if let Some(v) = body.enabled {
        set!("enabled", Some(v.to_string()), "::boolean");
    }
    if let Some(v) = body.client_id {
        set!("client_id", Some(v.trim().to_string()), "");
    }
    if let Some(v) = body.client_secret {
        let t = v.trim().to_string();
        if !t.is_empty() {
            set!("client_secret", Some(t), "");
        }
    }
    let domains: Option<Vec<String>> = body.allowed_domains.map(|v| {
        v.iter()
            .map(|d| d.trim().trim_start_matches('@').to_lowercase())
            .filter(|d| !d.is_empty())
            .collect()
    });
    if let Some(_) = domains {
        if !binds.is_empty() {
            q.push_str(", ");
        }
        q.push_str(&format!("allowed_domains = ${}", binds.len() + 1));
        binds.push(String::from("__DOMAINS__"));
    }
    if binds.is_empty() {
        return admin_get(State(state)).await;
    }
    q.push_str(", updated_at = NOW() WHERE id = true");
    let mut qb = sqlx::query(&q);
    for b in binds {
        if b == "__DOMAINS__" {
            qb = qb.bind(domains.clone().unwrap_or_default());
        } else {
            qb = qb.bind(b);
        }
    }
    qb.execute(&state.pool).await?;
    admin_get(State(state)).await
}
