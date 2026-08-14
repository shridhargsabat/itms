pub mod assets;
pub mod audit;
pub mod cmdb;
pub mod dashboard;
pub mod tickets;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum::Router;
use serde_json::json;

use crate::db::AppState;

/// Assemble every /api/v1 sub-router.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/dashboard", dashboard::router())
        .nest("/assets", assets::router())
        .nest("/tickets", tickets::router())
        .nest("/cmdb", cmdb::router())
        .nest("/audit", audit::router())
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
