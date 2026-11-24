// #53: Google SSO — admin-configurable OAuth 2.0 with account linking.
//
// The admin configures client_id / client_secret / allowed_domains from the
// Settings UI (PUT /admin/oauth). The flow is disabled until `enabled=true`.
//
//   /auth/oauth/status   (public)  → { enabled, client_id_set }
//   /auth/oauth/start    (public)  → set state cookie + 302 to Google consent
//   /auth/oauth/callback (public)  → exchange → link → mint code → 302 SPA (?code=)
//   /auth/oauth/exchange (public)  → redeem code once → { token, user }
//   /admin/oauth         (admin)   → GET masked config / PUT update
//
// Security defaults: NO auto-provisioning (SSO only links to existing
// accounts — email must match a users row), optional domain allowlist
// (empty = any existing user, best used with a non-empty allowlist),
// one-time 10-min state nonces (DB + HttpOnly cookie double-submit), single-use
// 5-min exchange codes (sha256 hash at rest), email_verified required. The
// session token NEVER appears in a URL — callback redirects carry only the
// one-time code, redeemed over POST from JS (which strips it from history).
//
// Test-only env overrides (never set in prod): GOOGLE_OAUTH_TOKEN_URL and
// GOOGLE_OAUTH_USERINFO_URL let local verification run a mock IdP.

use axum::extract::{ConnectInfo, Extension, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::auth::{generate_token, hash_token};
use super::auth::{cookie_value, set_cookie_headers, SESSION_TTL};
use super::AppError;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const STATE_TTL_MINUTES: i64 = 10;
/// Wave-2a: single-use SSO exchange codes live only 5 minutes.
const OAUTH_CODE_TTL_MINUTES: i64 = 5;
/// Wave-2a: HttpOnly cookie binding the OAuth state nonce to the browser that
/// started the flow (CSRF on the callback redirects nowhere without it).
pub const OAUTH_STATE_COOKIE: &str = "itms_oauth_state";
const OAUTH_STATE_COOKIE_MAX_AGE_SECS: i64 = STATE_TTL_MINUTES * 60;

fn oauth_state_set_cookie(nonce: &str) -> String {
    format!(
        "{OAUTH_STATE_COOKIE}={nonce}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age={OAUTH_STATE_COOKIE_MAX_AGE_SECS}"
    )
}

fn oauth_state_clear_cookie() -> String {
    format!("{OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0")
}

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
/// Wave-2a: also sets an HttpOnly cookie carrying the state nonce; the
/// callback requires cookie == query state (double-submit binding).
pub async fn start(
    State(state): State<super::AppState>,
    headers: axum::http::HeaderMap,
) -> Result<(HeaderMap, axum::response::Redirect), AppError> {
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
    Ok((
        set_cookie_headers(oauth_state_set_cookie(&state_nonce))?,
        axum::response::Redirect::temporary(&url),
    ))
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

/// GET /auth/oauth/callback — verify state binding, exchange code, link to an
/// existing account, mint a single-use exchange code, then 302 to the SPA
/// with ONLY `?code=` (no token/user in the URL — wave-2a).
pub async fn callback(
    State(state): State<super::AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Result<(HeaderMap, axum::response::Redirect), AppError> {
    let base = base_url(&headers);
    if let Some(err) = &params.error {
        return Ok((
            set_cookie_headers(oauth_state_clear_cookie())?,
            axum::response::Redirect::temporary(&format!("{base}/login?error=sso_{err}")),
        ));
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

    // double-submit binding: the HttpOnly cookie set by /start must match the
    // query state — a CSRF'd callback from another browser has no cookie.
    // Checked BEFORE consuming the DB nonce so failures don't burn the state.
    if cookie_value(&headers, OAUTH_STATE_COOKIE).as_deref() != Some(state_nonce.as_str()) {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            "OAuth state mismatch — please try signing in again",
        ));
    }

    // one-time state nonce, TTL-enforced in the predicate (not just by the
    // /start housekeeping sweep, which may not have run recently).
    let consumed = sqlx::query(
        "DELETE FROM oauth_states WHERE state = $1 AND created_at > NOW() - make_interval(mins => $2::int)",
    )
    .bind(&state_nonce)
    .bind(STATE_TTL_MINUTES)
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
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, String, bool)>(
        "SELECT id, email, name, role, department, theme, active FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    let (id, _, _, _, _, _, active) = match row {
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

    // Mint a single-use exchange code (hash at rest, 5-min TTL). The session
    // itself is created at redeem time in /exchange — never in this redirect.
    let code = generate_token();
    sqlx::query(
        "INSERT INTO oauth_codes (code_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + make_interval(mins => $3::int))",
    )
    .bind(hash_token(&code))
    .bind(id)
    .bind(OAUTH_CODE_TTL_MINUTES)
    .execute(&state.pool)
    .await?;
    // housekeeping: drop expired codes
    sqlx::query("DELETE FROM oauth_codes WHERE expires_at <= NOW()")
        .execute(&state.pool)
        .await?;

    // SPA route POSTs the code to /exchange, strips it from history, goes home.
    // The state cookie is single-flow: clear it now that the flow completed.
    Ok((
        set_cookie_headers(oauth_state_clear_cookie())?,
        axum::response::Redirect::temporary(&format!("{base}/oauth/callback?code={code}")),
    ))
}

// ---------------------------------------------------------------------------
// Wave-2a: single-use code redemption
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExchangeRequest {
    pub code: String,
}

/// POST /auth/oauth/exchange — redeem the callback's one-time code for a real
/// session. The DELETE...RETURNING both enforces single-use and the TTL
/// atomically: concurrent double-redeems yield exactly one session.
pub async fn exchange(
    State(state): State<super::AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ExchangeRequest>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    // brute-force brake on code guessing (legit clients redeem exactly once)
    let ip = super::auth::client_ip(Some(peer), &headers);
    super::auth::rate_limited_public(&state, &format!("ssox:{ip}"))?;

    let code = body.code.trim();
    if code.is_empty() {
        return Err(AppError::new(
            StatusCode::BAD_REQUEST,
            "invalid or expired SSO code — please try signing in again",
        ));
    }
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "DELETE FROM oauth_codes WHERE code_hash = $1 AND expires_at > NOW() RETURNING user_id",
    )
    .bind(hash_token(code))
    .fetch_optional(&state.pool)
    .await?;
    let user_id = match user_id {
        Some(u) => u,
        None => {
            return Err(AppError::new(
                StatusCode::BAD_REQUEST,
                "invalid or expired SSO code — please try signing in again",
            ))
        }
    };
    // housekeeping: drop other expired codes
    sqlx::query("DELETE FROM oauth_codes WHERE expires_at <= NOW()")
        .execute(&state.pool)
        .await?;

    // re-check the account at redeem time (may have been disabled/deleted
    // between callback and exchange).
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, String, bool)>(
        "SELECT id, email, name, role, department, theme, active FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;
    let (id, email, name, role, department, theme, active) = match row {
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

    Ok((
        set_cookie_headers(super::auth::session_set_cookie(&token))?,
        Json(json!({
            "token": token,
            "expires_at": expires_at,
            "user": { "id": id, "email": email, "name": name, "role": role, "department": department, "theme": theme },
        })),
    ))
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
/// Wave-1a: admin-only, mirroring admin_put (was: any authenticated user).
pub async fn admin_get(
    State(state): State<super::AppState>,
    Extension(role): Extension<String>,
) -> Result<Json<OAuthConfigView>, AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admin only"));
    }
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
        // role already verified above — forward an ADMIN identity.
        return admin_get(State(state), Extension("ADMIN".to_string())).await;
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
    admin_get(State(state), Extension("ADMIN".to_string())).await
}

#[cfg(test)]
mod wave1a_tests {
    use super::*;

    /// Lazy pool: parses the URL, opens NO connection. The 403 path returns
    /// before any DB touch, so this test is DB-free.
    fn test_state() -> super::super::AppState {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://localhost/itms_unit_test")
            .expect("lazy pool");
        super::super::AppState {
            pool,
            login_attempts: Default::default(),
            opencode_api_key: None,
        }
    }

    #[tokio::test]
    async fn admin_get_forbids_non_admin_without_touching_db() {
        for role in ["EMPLOYEE", "AGENT", "", "admin"] {
            let err = admin_get(State(test_state()), Extension(role.to_string()))
                .await
                .unwrap_err();
            assert_eq!(err.status, StatusCode::FORBIDDEN, "role={role}");
        }
    }
}

#[cfg(test)]
mod wave2a_tests {
    use super::*;

    #[test]
    fn state_cookie_is_httponly_lax_secure_with_ten_min_ttl() {
        let v = oauth_state_set_cookie("nonce123");
        assert!(v.starts_with("itms_oauth_state=nonce123;"), "carries nonce: {v}");
        for flag in ["Path=/", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=600"] {
            assert!(v.contains(flag), "missing {flag}: {v}");
        }
    }

    #[test]
    fn state_clear_cookie_empties_with_zero_max_age() {
        let v = oauth_state_clear_cookie();
        assert!(v.starts_with("itms_oauth_state=;"), "empties value: {v}");
        assert!(v.contains("Max-Age=0"), "zero max-age: {v}");
    }

    #[test]
    fn exchange_code_ttl_is_five_minutes() {
        assert_eq!(OAUTH_CODE_TTL_MINUTES, 5);
        assert_eq!(OAUTH_STATE_COOKIE_MAX_AGE_SECS, STATE_TTL_MINUTES * 60);
    }
}
