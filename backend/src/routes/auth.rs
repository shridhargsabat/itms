//! /auth/* routes + the Bearer-token guard used on every protected route.

use axum::extract::{ConnectInfo, Extension, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = client_ip(Some(peer), &headers);
    let email = body.email.trim().to_lowercase();
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, String, Option<String>, bool)>(
        "SELECT id, email, name, role, department, theme, password_hash, active FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let (id, email, name, role, department, theme, password_hash, active) = match row {
        Some(r) => r,
        None => {
            // #95: burn a full argon2 verify so unknown/known emails are
            // indistinguishable by latency; also count toward the rate buckets
            rate_limited_public(&state, &ip)?;
            rate_limited_account(&state, &email)?;
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
        // wave-1a: ...plus per-account throttle (6th failure → 429 + backoff)
        rate_limited_account(&state, &email)?;
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "invalid email or password"));
    }

    // correct credentials always pass and reset both buckets
    clear_rate_public(&state, &ip);
    clear_rate_public(&state, &account_key(&email));

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

const VALID_THEMES: [&str; 12] = [
    "light", "dark", "ledgerly", "ledgerly-light", "system", "paper",
    "console", "bold", "shell", "terminal", "clarity", "clarity-dark",
];

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
            "theme must be one of: light, dark, ledgerly, ledgerly-light, system, paper, console, bold, shell, terminal, clarity, clarity-dark",
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

/// Staff check shared by handler-level gates (tickets, audit): ADMIN or AGENT.
/// Strict allowlist — any unexpected role value is denied.
pub fn is_staff_role(role: &str) -> bool {
    matches!(role, "ADMIN" | "AGENT")
}

/// RBAC middleware: 403 unless the authenticated user is staff (ADMIN/AGENT).
/// Must run inside `require_auth` (the role extension is populated there).
pub async fn require_staff(req: Request, next: Next) -> Result<Response, AppError> {
    let role = req
        .extensions()
        .get::<String>()
        .map(|r| r.as_str())
        .unwrap_or("");
    if !is_staff_role(role) {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "staff role required",
        ));
    }
    Ok(next.run(req).await)
}

pub(crate) fn bearer_token(headers: &HeaderMap) -> Result<String, AppError> {    let value = headers
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

/// Wave-1a fix (hardened): trusted-proxy-aware rate-limit key source.
///
/// Behind TWO proxies (client -> traefik -> nginx(frontend) -> backend) the
/// TCP peer is ALWAYS nginx, and each proxy APPENDS to X-Forwarded-For, so a
/// leftmost pick is spoofable: an attacker-prepended entry stays leftmost
/// through appends. Blindly preferring peer is also wrong: it collapses every
/// client into one shared 10-fail/15min bucket (anonymous global login DoS).
/// `TRUSTED_PROXIES` (comma-separated IPv4 addresses and/or CIDRs, default
/// empty = trust none) lists the proxies allowed to vouch via X-Forwarded-For.
/// Chain = valid XFF IPs in order (invalid/empty dropped) + TCP peer as the
/// rightmost entry; walk from the RIGHT skipping trust-set members and return
/// the first UNTRUSTED address:
/// - untrusted peer, or empty trust set → peer immediately (XFF ignored);
/// - all-trusted chain, or no valid XFF → peer;
/// - no peer (unix sockets, unit tests) → existing XFF fallback.
pub fn client_ip(peer: Option<SocketAddr>, headers: &HeaderMap) -> String {
    let trusted_raw = std::env::var("TRUSTED_PROXIES").unwrap_or_default();
    client_ip_with_trust(peer, headers, &trusted_raw)
}

fn client_ip_with_trust(
    peer: Option<SocketAddr>,
    headers: &HeaderMap,
    trusted_raw: &str,
) -> String {
    match peer {
        None => client_ip_public(headers),
        Some(addr) => {
            let peer_ip = addr.ip();
            let mut chain = parse_valid_xff_ips(headers);
            chain.push(peer_ip);
            for ip in chain.iter().rev() {
                if !peer_is_trusted(ip, trusted_raw) {
                    return ip.to_string();
                }
            }
            peer_ip.to_string()
        }
    }
}

/// All valid X-Forwarded-For entries in header order, dropping invalid/empty
/// entries. Attacker garbage must neither become a rate-limit key nor shift
/// the rightmost-untrusted walk.
fn parse_valid_xff_ips(headers: &HeaderMap) -> Vec<IpAddr> {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            s.split(',')
                .map(|e| e.trim())
                .filter(|e| !e.is_empty())
                .filter_map(|e| e.parse::<IpAddr>().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn peer_is_trusted(peer_ip: &IpAddr, trusted_raw: &str) -> bool {
    let peer_v4 = match peer_ip {
        IpAddr::V4(v4) => *v4,
        _ => return false, // trust set is IPv4-only; v6 peers never trusted
    };
    trusted_raw
        .split(',')
        .map(|e| e.trim())
        .filter(|e| !e.is_empty())
        .any(|e| trust_entry_matches(peer_v4, e))
}

fn trust_entry_matches(peer: Ipv4Addr, entry: &str) -> bool {
    if let Some((net_s, prefix_s)) = entry.split_once('/') {
        let (Ok(net), Ok(prefix)) = (
            net_s.trim().parse::<Ipv4Addr>(),
            prefix_s.trim().parse::<u8>(),
        ) else {
            return false; // malformed CIDR entry never matches (fail closed)
        };
        if prefix > 32 {
            return false;
        }
        return cidr_contains(net, prefix, peer);
    }
    entry.parse::<Ipv4Addr>().is_ok_and(|a| a == peer)
}

/// Minimal IPv4 CIDR contains — no new dependencies.
fn cidr_contains(network: Ipv4Addr, prefix: u8, ip: Ipv4Addr) -> bool {
    if prefix == 0 {
        return true;
    }
    let mask: u32 = u32::MAX << (32 - prefix);
    (u32::from(network) & mask) == (u32::from(ip) & mask)
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

// ---- wave-1a: per-account email throttle with backoff ----

const AUTH_ACCT_MAX: usize = 5;

fn account_key(email: &str) -> String {
    format!("acct:{email}")
}

/// Count a FAILED login toward the per-account bucket: the 6th failure
/// within 15 min → 429. Attempts past the limit keep pushing timestamps,
/// extending the sliding window (backoff). Cleared on successful login.
/// (Record-on-failure only, like the IP bucket — no pre-check, so the #95
/// unknown/known indistinguishability posture is preserved.)
pub fn rate_limited_account(state: &AppState, email: &str) -> Result<(), AppError> {
    let mut m = state.login_attempts.lock().unwrap();
    let now = std::time::Instant::now();
    let v = m.entry(account_key(email)).or_default();
    v.retain(|t| now.duration_since(*t).as_secs() < AUTH_RATE_WINDOW_SECS);
    if v.len() >= AUTH_ACCT_MAX {
        v.push(now); // hammering while locked extends the lockout (backoff)
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "too many login attempts for this account — try again in 15 minutes",
        ));
    }
    v.push(now);
    Ok(())
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

/// Wave-1a: pure predicate behind the demo gate — exactly "true" enables.
fn demo_enabled_value(v: Option<&str>) -> bool {
    matches!(v, Some("true"))
}

pub async fn demo_login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let ip = client_ip(Some(peer), &headers);
    rate_limited_public(&state, &format!("demo:{ip}"))?;
    // wave-1a: default-DENY — enabled ONLY when the env var is exactly "true".
    let enabled = demo_enabled_value(std::env::var("DEMO_LOGIN_ENABLED").ok().as_deref());
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
    use super::{is_staff_role, is_valid_theme};
    #[test]
    fn allowlist_covers_all_twelve_modes() {
        for t in ["light","dark","ledgerly","ledgerly-light","system","paper","console","bold","shell","terminal","clarity","clarity-dark"] {
            assert!(is_valid_theme(t), "missing {t}");
        }
        assert!(!is_valid_theme("paper "));
        assert!(!is_valid_theme("DARK"));
        assert!(!is_valid_theme(""));
    }

    #[test]
    fn staff_gate_allows_admin_and_agent_only() {
        assert!(is_staff_role("ADMIN"));
        assert!(is_staff_role("AGENT"));
        assert!(!is_staff_role("EMPLOYEE"));
        assert!(!is_staff_role(""));
        assert!(!is_staff_role("admin")); // case-sensitive: exact role strings only
        assert!(!is_staff_role("SUPERADMIN"));
    }
}

#[cfg(test)]
mod wave1a_tests {
    use super::*;
    use crate::db::AppState;

    /// Lazy pool: parses the URL, opens NO connection — DB-free tests.
    fn test_state() -> AppState {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://localhost/itms_unit_test")
            .expect("lazy pool");
        AppState {
            pool,
            login_attempts: Default::default(),
            opencode_api_key: None,
        }
    }

    fn headers_with_xff(xff: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", xff.parse().unwrap());
        h
    }

    #[test]
    fn client_ip_prefers_peer_over_spoofable_xff() {
        // Deterministic: empty trust set must ignore XFF even via the
        // env-reading entry point (clear any leaked TRUSTED_PROXIES first —
        // no other test touches process env, so this cannot race).
        std::env::remove_var("TRUSTED_PROXIES");
        let h = headers_with_xff("9.9.9.9");
        let peer: SocketAddr = "198.51.100.7:4321".parse().unwrap();
        assert_eq!(client_ip(Some(peer), &h), "198.51.100.7");
        assert_eq!(client_ip_with_trust(Some(peer), &h, ""), "198.51.100.7");
    }

    #[test]
    fn client_ip_falls_back_to_xff_without_peer() {
        let h = headers_with_xff("203.0.113.9, 10.0.0.1");
        assert_eq!(client_ip(None, &h), "203.0.113.9");
        assert_eq!(client_ip(None, &HeaderMap::new()), "unknown");
    }

    #[tokio::test]
    async fn ip_bucket_trips_on_11th_failure() {
        let s = test_state();
        for _ in 0..10 {
            assert!(rate_limited_public(&s, "203.0.113.9").is_ok());
        }
        let err = rate_limited_public(&s, "203.0.113.9").unwrap_err();
        assert_eq!(err.status, StatusCode::TOO_MANY_REQUESTS);
        clear_rate_public(&s, "203.0.113.9");
        assert!(rate_limited_public(&s, "203.0.113.9").is_ok());
    }

    #[tokio::test]
    async fn account_bucket_trips_on_6th_failure_and_backs_off() {
        let s = test_state();
        for _ in 0..5 {
            assert!(rate_limited_account(&s, "victim@example.com").is_ok());
        }
        let err = rate_limited_account(&s, "victim@example.com").unwrap_err();
        assert_eq!(err.status, StatusCode::TOO_MANY_REQUESTS);
        // hammering while locked extends the bucket instead of sliding off
        let len_before = s.login_attempts.lock().unwrap().len();
        let _ = rate_limited_account(&s, "victim@example.com");
        let bucket = s.login_attempts.lock().unwrap();
        assert!(bucket["acct:victim@example.com"].len() > 5);
        assert_eq!(len_before, 1);
        // other accounts unaffected
        drop(bucket);
        assert!(rate_limited_account(&s, "other@example.com").is_ok());
        // success-path clear resets
        clear_rate_public(&s, "acct:victim@example.com");
        assert!(rate_limited_account(&s, "victim@example.com").is_ok());
    }

    #[test]
    fn demo_gate_is_default_deny_exact_true_only() {
        assert!(!demo_enabled_value(None));
        assert!(!demo_enabled_value(Some("")));
        assert!(!demo_enabled_value(Some("false")));
        assert!(!demo_enabled_value(Some("0")));
        assert!(!demo_enabled_value(Some("True")));
        assert!(!demo_enabled_value(Some("TRUE")));
        assert!(!demo_enabled_value(Some("1")));
        assert!(demo_enabled_value(Some("true")));
    }

    #[test]
    fn trusted_peer_xff_yields_xff_ip() {
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        // exact-IP trust entry
        let h = headers_with_xff("203.0.113.9");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1"),
            "203.0.113.9"
        );
        // rightmost-untrusted of a chain wins
        let h = headers_with_xff("203.0.113.9, 10.0.0.1");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.2, 10.0.0.1"),
            "203.0.113.9"
        );
        // CIDR trust entry
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.0/8"),
            "203.0.113.9"
        );
    }

    #[test]
    fn untrusted_peer_spoofed_xff_yields_peer() {
        let h = headers_with_xff("9.9.9.9");
        let peer: SocketAddr = "198.51.100.7:4321".parse().unwrap();
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1"),
            "198.51.100.7"
        );
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.0/8"),
            "198.51.100.7"
        );
    }

    #[test]
    fn invalid_xff_yields_peer_even_when_trusted() {
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        for bad in ["not-an-ip", "999.999.999.999", "", "   ", "203.0.113.9x"] {
            let h = headers_with_xff(bad);
            assert_eq!(
                client_ip_with_trust(Some(peer), &h, "10.0.0.1"),
                "10.0.0.1",
                "bad XFF {bad:?} must fall back to peer"
            );
        }
        // missing header entirely
        assert_eq!(
            client_ip_with_trust(Some(peer), &HeaderMap::new(), "10.0.0.1"),
            "10.0.0.1"
        );
    }

    #[test]
    fn empty_trust_set_yields_peer() {
        let h = headers_with_xff("203.0.113.9");
        let peer: SocketAddr = "172.18.0.2:4321".parse().unwrap(); // e.g. Traefik
        for trust in ["", "   ", " , , "] {
            assert_eq!(
                client_ip_with_trust(Some(peer), &h, trust),
                "172.18.0.2",
                "empty trust {trust:?} must ignore XFF"
            );
        }
        // malformed trust entries fail closed → peer
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "bogus, 10.0.0.0/99, 1.2.3.4/abc"),
            "172.18.0.2"
        );
    }

    #[test]
    fn cidr_boundary_matches_inside_only() {
        // 172.20.0.5 ∈ 172.20.0.0/16, 172.21.0.5 ∉
        let net: Ipv4Addr = "172.20.0.0".parse().unwrap();
        assert!(cidr_contains(net, 16, "172.20.0.5".parse().unwrap()));
        assert!(cidr_contains(net, 16, "172.20.255.255".parse().unwrap()));
        assert!(!cidr_contains(net, 16, "172.21.0.5".parse().unwrap()));
        assert!(!cidr_contains(net, 16, "172.19.255.255".parse().unwrap()));
        // /32 = exact host, /0 = everything
        assert!(cidr_contains(
            "10.1.2.3".parse().unwrap(),
            32,
            "10.1.2.3".parse().unwrap()
        ));
        assert!(!cidr_contains(
            "10.1.2.3".parse().unwrap(),
            32,
            "10.1.2.4".parse().unwrap()
        ));
        assert!(cidr_contains(
            "0.0.0.0".parse().unwrap(),
            0,
            "192.0.2.1".parse().unwrap()
        ));
        // end-to-end through client_ip: inside CIDR → XFF, outside → peer
        let h = headers_with_xff("203.0.113.9");
        let inside: SocketAddr = "172.20.0.5:80".parse().unwrap();
        let outside: SocketAddr = "172.21.0.5:80".parse().unwrap();
        assert_eq!(
            client_ip_with_trust(Some(inside), &h, "172.20.0.0/16"),
            "203.0.113.9"
        );
        assert_eq!(
            client_ip_with_trust(Some(outside), &h, "172.20.0.0/16"),
            "172.21.0.5"
        );
    }

    #[test]
    fn two_proxy_chain_with_spoof_yields_real() {
        // client -> traefik (172.18.0.2) -> nginx peer (10.0.0.1) -> backend.
        // Attacker prepends spoof; proxies append real client + traefik.
        // XFF [spoof, real, traefik] + peer nginx; trust covers traefik+nginx.
        // Leftmost would yield the spoof; rightmost-untrusted must yield real.
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        let trust = "10.0.0.1, 172.18.0.2";
        let h = headers_with_xff("198.51.100.99, 203.0.113.9, 172.18.0.2");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, trust),
            "203.0.113.9"
        );
        // CIDR trust entries behave the same
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.0/8, 172.18.0.0/16"),
            "203.0.113.9"
        );
        // invalid/empty entries are dropped, walk is unaffected
        let h = headers_with_xff("garbage, 198.51.100.99, 203.0.113.9, 172.18.0.2, , ");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, trust),
            "203.0.113.9"
        );
    }

    #[test]
    fn two_proxy_chain_without_spoof_yields_real() {
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        let trust = "10.0.0.1, 172.18.0.2";
        let h = headers_with_xff("203.0.113.9, 172.18.0.2");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, trust),
            "203.0.113.9"
        );
    }

    #[test]
    fn all_trusted_chain_yields_peer() {
        // Every address in chain + peer is trusted → fall back to peer.
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        let h = headers_with_xff("10.0.0.2, 172.18.0.2");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.0/8, 172.18.0.0/16"),
            "10.0.0.1"
        );
        // exact-IP trust entries, same outcome
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1, 10.0.0.2, 172.18.0.2"),
            "10.0.0.1"
        );
    }

    #[test]
    fn untrusted_peer_ignores_xff_chain_entirely() {
        // Direct-hit attacker: peer not in trust set → peer wins even though
        // XFF carries a plausible real client + trusted proxy entries.
        let peer: SocketAddr = "198.51.100.7:4321".parse().unwrap();
        let h = headers_with_xff("203.0.113.9, 172.18.0.2");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1, 172.18.0.2"),
            "198.51.100.7"
        );
        // spoofed variant: still peer, never the spoof or the real client
        let h = headers_with_xff("198.51.100.99, 203.0.113.9, 172.18.0.2");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1, 172.18.0.2"),
            "198.51.100.7"
        );
    }

    #[test]
    fn empty_trust_set_ignores_two_proxy_chain() {
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        let h = headers_with_xff("198.51.100.99, 203.0.113.9, 172.18.0.2");
        for trust in ["", "   ", " , , "] {
            assert_eq!(
                client_ip_with_trust(Some(peer), &h, trust),
                "10.0.0.1",
                "empty trust {trust:?} must ignore full chain"
            );
        }
    }

    #[test]
    fn single_proxy_chain_still_correct() {
        // Regression: one proxy in front, XFF [real] + trusted peer → real.
        let peer: SocketAddr = "10.0.0.1:4321".parse().unwrap();
        let h = headers_with_xff("203.0.113.9");
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.1"),
            "203.0.113.9"
        );
        assert_eq!(
            client_ip_with_trust(Some(peer), &h, "10.0.0.0/8"),
            "203.0.113.9"
        );
    }
}
