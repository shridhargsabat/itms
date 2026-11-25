pub mod assets;
pub mod invoice;
pub mod comments;
pub mod intake;
pub mod audit;
pub mod auth;
pub mod password;
pub mod kb;
pub mod oauth;
pub mod locations;
pub mod templates;
pub mod vendors;
pub mod reports;
pub mod cmdb;
pub mod dashboard;
pub mod masters;
pub mod notifications;
pub mod sla;
pub mod onboarding;
pub mod licenses;
pub mod requests;
pub mod tickets;
pub mod users;

use axum::extract::State;
use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Json;
use axum::Router;

/// #91: CSV formula injection guard — cells starting with = + - @ tab CR get a
/// single-quote prefix (OWASP mitigation) so Excel/Sheets never evaluates them.
pub fn csv_safe(v: &str) -> String {
    let v = v.trim_start_matches('\u{feff}');
    if v.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{v}")
    } else {
        v.to_string()
    }
}
use serde_json::json;

use crate::db::AppState;

/// Assemble every /api/v1 sub-router. `/auth/login` is public; everything else
/// (including /auth/logout and /auth/me) sits behind the Bearer-token guard.
pub fn api_router(state: AppState) -> Router<AppState> {
    let protected = Router::new()
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/theme", put(auth::set_theme))
        .route("/auth/change-password", post(password::change_password))
        .nest("/dashboard", dashboard::router())
        .nest("/assets", assets::router())
        // invoice-parse: POST /assets/parse-invoice (+ link) is an ADMIN mutation;
        // the docs list/download (any authenticated user) are merged at root
        // (they define full /assets/{id}/documents paths — a nest("/") would panic).
        .nest("/assets", invoice::mutations_router())
        .merge(invoice::documents_router())
        .nest("/tickets", comments::router())
        .nest("/tickets", tickets::router())
        .route("/tickets/{id}/convert-to-article", post(kb::convert_to_article))
        .route("/attachments/{attachment_id}/download", get(comments::download_attachment))
        .nest("/cmdb", cmdb::router())
        .nest("/audit", audit::router())
        // Users + masters: reads open to all authenticated users, mutations
        // ADMIN-only — the per-route split lives inside each module.
        .nest("/users", users::router())
        .nest("/masters", masters::router())
        .nest("/onboarding", onboarding::router())
        .nest("/notifications", notifications::router())
        .nest("/sla", sla::router())
        .nest("/kb", kb::router())
        .nest("/templates", templates::router())
        .nest("/requests", requests::router())
        .nest("/licenses", licenses::router())
        // Phase 2 (#39 vendors/claims, #49 reports) — flat routes, same auth layer
        .route("/vendors", get(vendors::list_vendors).post(vendors::create_vendor))
        .route("/vendors/{id}", put(vendors::update_vendor).delete(vendors::delete_vendor))
        // Phase 2 (#40 locations)
        .route("/locations", get(locations::list_locations).post(locations::create_location))
        .route("/locations/{id}", put(locations::update_location).delete(locations::delete_location))
        .route("/locations/{id}/assets", get(locations::location_assets))
        .route("/claims", get(vendors::list_claims).post(vendors::create_claim))
        .route("/claims/{id}", delete(vendors::delete_claim))
        .route("/reports/repeat-incidents", get(reports::repeat_incidents))
        // #53 Google SSO admin config (admin in-handler)
        .route("/admin/oauth", get(oauth::admin_get).put(oauth::admin_put))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    // intake is PUBLIC (token-gated inside the handler — the email cron has
    // no portal session, only the shared X-Intake-Token secret)
    let public = Router::new()
        .nest("/intake", intake::router())
        .nest("/sla", sla::escalate_router())
        // #53 Google SSO flow — no session needed (pre-login)
        .route("/auth/oauth/status", get(oauth::status))
        .route("/auth/oauth/start", get(oauth::start))
        .route("/auth/oauth/callback", get(oauth::callback))
        // wave-2a: single-use code redemption (token never in URL)
        .route("/auth/oauth/exchange", post(oauth::exchange));

    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .route("/auth/login", post(auth::login))
        .route("/auth/forgot-password", post(password::forgot_password))
        .route("/auth/reset-password", post(password::reset_password))
        .route("/auth/demo", post(auth::demo_login))
        .merge(protected)
        .merge(public)
}

/// wave-2b: GET /readyz — readiness probe. /healthz stays the cheap liveness
/// check (no I/O); /readyz additionally proves a live DB connection via
/// SELECT 1 so the orchestrator only routes traffic to a serving backend.
async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(e) => {
            tracing::warn!("readyz: db probe failed: {e}");
            (StatusCode::SERVICE_UNAVAILABLE, "not ready")
        }
    }
}

/// Uniform JSON error for the whole API: `{"error": "..."}`.
#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}

impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!("database error: {err}");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal server error",
        )
    }
}

/// TBE-22: path-id extractor that reports 422 (not axum's default 400) when
/// a path segment fails to parse — so "bad id in path" matches "bad id in
/// body" (serde failures surface as 422). Drop-in for `Path<T>`: destructure
/// `UuidPath(id)` / `UuidPath((a, b))` exactly like `Path`.
pub struct UuidPath<T>(pub T);

impl<S, T> axum::extract::FromRequestParts<S> for UuidPath<T>
where
    T: serde::de::DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(v)) => Ok(UuidPath(v)),
            Err(_) => Err(AppError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid id in path",
            )),
        }
    }
}
