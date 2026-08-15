pub mod assets;
pub mod audit;
pub mod auth;
pub mod cmdb;
pub mod dashboard;
pub mod masters;
pub mod onboarding;
pub mod tickets;
pub mod users;

use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde_json::json;

use crate::db::AppState;

/// Assemble every /api/v1 sub-router. `/auth/login` is public; everything else
/// (including /auth/logout and /auth/me) sits behind the Bearer-token guard.
pub fn api_router(state: AppState) -> Router<AppState> {
    let protected = Router::new()
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .nest("/dashboard", dashboard::router())
        .nest("/assets", assets::router())
        .nest("/tickets", tickets::router())
        .nest("/cmdb", cmdb::router())
        .nest("/audit", audit::router())
        // Users + masters: reads open to all authenticated users, mutations
        // ADMIN-only — the per-route split lives inside each module.
        .nest("/users", users::router())
        .nest("/masters", masters::router())
        .nest("/onboarding", onboarding::router())
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/auth/login", post(auth::login))
        .merge(protected)
}

/// Uniform JSON error for the whole API: `{"error": "..."}`.
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
