mod audit;
mod auth;
mod db;
mod models;
mod pagination;
mod routes;

use axum::http::{HeaderValue, Method};
use axum::Router;
use dotenvy::dotenv;
use std::net::SocketAddr;
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
        opencode_api_key: std::env::var("OPENCODE_GO_API_KEY").ok(),
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
    // Clone the pool BEFORE serve consumes `state` so we can drain it after
    // the listener stops accepting.
    let pool = state.pool.clone();
    // wave-1a: inject ConnectInfo<SocketAddr> (TCP peer addr) so auth rate
    // limits key on the real peer instead of trusting X-Forwarded-For alone.
    axum::serve(
        listener,
        app.with_state(state)
            .into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    // Bounded pool drain: give in-flight queries a grace period, then exit
    // anyway so the orchestrator's SIGKILL never has to do the job.
    match tokio::time::timeout(std::time::Duration::from_secs(10), pool.close()).await
    {
        Ok(()) => tracing::info!("shutdown complete — pool drained"),
        Err(_) => tracing::warn!("pool drain timed out after 10s — exiting anyway"),
    }

    Ok(())
}

/// wave-2b: resolve on SIGTERM (docker stop / orchestrator) or SIGINT (Ctrl+C)
/// so axum stops accepting while in-flight requests drain.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received — draining in-flight requests");
}
