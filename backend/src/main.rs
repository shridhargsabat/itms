mod audit;
mod auth;
mod db;
mod models;
mod routes;

use axum::http::{HeaderValue, Method};
use axum::Router;
use dotenvy::dotenv;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug,axum::rejection=trace".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")?;
    let pool = db::create_pool(&database_url).await?;

    // Apply any pending migrations at boot (idempotent).
    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("database migrations applied");

    let state = db::AppState {
        pool,
        login_attempts: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list([
            "http://localhost:5173".parse::<HeaderValue>()?,
            "https://itms.ai-automation-hub.tech".parse::<HeaderValue>()?,
        ]))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::OPTIONS])
        .allow_headers(Any);

    let app: Router<db::AppState> = Router::new()
        .nest("/api/v1", routes::api_router(state.clone()))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    tracing::info!("ITMS backend listening on http://0.0.0.0:{port}");
    axum::serve(listener, app.with_state(state)).await?;

    Ok(())
}
