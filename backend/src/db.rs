use std::time::Duration;

use sqlx::postgres::{PgPool, PgPoolOptions};

/// Create a Postgres connection pool from a DATABASE_URL.
pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(database_url)
        .await
}

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Per-IP failed-login attempt window (login + forgot-password rate limit, #86)
    pub login_attempts: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Vec<std::time::Instant>>>>,
    /// OpenCode Go bearer token for invoice OCR/parsing (mimo-v2.5). Injected via
    /// OPENCODE_GO_API_KEY; None when unset (invoice parse returns a clear error).
    pub opencode_api_key: Option<String>,
}
