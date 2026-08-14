//! Seed the ITMS database with demo data.
//!
//! Usage: DATABASE_URL=postgres://itms:...@localhost:5432/itms cargo run --bin seed
//!
//! Truncates all tables, then inserts 4 users, 10 assets, 5 tickets and
//! 4 CI relationships, printing row counts per table at the end.

use chrono::NaiveDate;
use dotenvy::dotenv;
use serde_json::json;
use sqlx::postgres::PgPool;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

/// Shared with the server binary via `#[path]` include so hashing stays identical.
#[path = "../auth.rs"]
mod auth;

/// Demo password for every seeded user (documented on the login page).
const DEMO_PASSWORD: &str = "demo1234";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    println!("Clearing existing data...");
    sqlx::query(
        "TRUNCATE audit_logs, ci_relationships, tickets, assets, users RESTART IDENTITY CASCADE",
    )
    .execute(&pool)
    .await?;

    // ------------------------------------------------------------------ users
    let admin_id = insert_user(&pool, "admin@itms.local", "IT Admin", "ADMIN", "IT").await?;
    let agent1_id = insert_user(&pool, "agent1@itms.local", "Support Lead", "AGENT", "IT").await?;
    let agent2_id = insert_user(&pool, "agent2@itms.local", "Support Lead", "AGENT", "IT").await?;
    let emp_id = insert_user(&pool, "emp@itms.local", "Finance Employee", "EMPLOYEE", "Finance").await?;

    // ----------------------------------------------------------------- assets
    // 2 LAPTOP, 1 DESKTOP, 4 SERVER (2 physical + 2 app hosts for the CMDB
    // graph), 1 NETWORK_DEVICE (switch), 1 MONITOR, 1 LICENSE.
    let laptop1_id = insert_asset(
        &pool,
        "AST-0001",
        "Dell Latitude 5440",
        "LAPTOP",
        "SN-DELL-5440-001",
        "ASSIGNED",
        Some(emp_id),
        json!({"cpu": "Intel Core i5-1345U", "ram_gb": 16, "storage_gb": 512, "os": "Windows 11 Pro"}),
        date(2025, 3, 10),
        date(2028, 3, 10),
    )
    .await?;

    let _laptop2_id = insert_asset(
        &pool,
        "AST-0002",
        "MacBook Pro 14",
        "LAPTOP",
        "SN-APL-MBP14-002",
        "ASSIGNED",
        Some(agent1_id),
        json!({"cpu": "Apple M3 Pro", "ram_gb": 18, "storage_gb": 512, "os": "macOS Sequoia"}),
        date(2025, 6, 1),
        date(2028, 6, 1),
    )
    .await?;

    let desktop1_id = insert_asset(
        &pool,
        "AST-0003",
        "HP EliteDesk 800 G9",
        "DESKTOP",
        "SN-HP-800G9-003",
        "ASSIGNED",
        Some(admin_id),
        json!({"cpu": "Intel Core i7-13700", "ram_gb": 32, "storage_gb": 1024, "os": "Ubuntu 24.04"}),
        date(2024, 11, 15),
        date(2027, 11, 15),
    )
    .await?;

    let server1_id = insert_asset(
        &pool,
        "AST-0004",
        "ProLiant DL380 Gen11",
        "SERVER",
        "SN-HPE-DL380-004",
        "IN_STOCK",
        None,
        json!({"cpu": "2x Xeon Gold 6430", "ram_gb": 256, "storage_gb": 4800, "rack": "R1-U12", "role": "application host"}),
        date(2025, 1, 20),
        date(2028, 1, 20),
    )
    .await?;

    let server2_id = insert_asset(
        &pool,
        "AST-0005",
        "PowerEdge R760",
        "SERVER",
        "SN-DELL-R760-005",
        "IN_STOCK",
        None,
        json!({"cpu": "2x Xeon Gold 6430", "ram_gb": 512, "storage_gb": 9600, "rack": "R1-U14", "role": "database host"}),
        date(2025, 1, 20),
        date(2028, 1, 20),
    )
    .await?;

    let switch1_id = insert_asset(
        &pool,
        "AST-0006",
        "Catalyst 9300-48P",
        "NETWORK_DEVICE",
        "SN-CSCO-C9300-006",
        "MAINTENANCE",
        None,
        json!({"ports": 48, "poe": true}),
        date(2024, 9, 5),
        date(2027, 9, 5),
    )
    .await?;

    let monitor1_id = insert_asset(
        &pool,
        "AST-0007",
        "Dell UltraSharp U2723QE",
        "MONITOR",
        "SN-DELL-U2723-007",
        "RETIRED",
        None,
        json!({"screen_size_in": 27, "resolution": "3840x2160"}),
        date(2021, 5, 12),
        date(2024, 5, 12),
    )
    .await?;

    let license1_id = insert_asset(
        &pool,
        "AST-0008",
        "Adobe Creative Cloud - Team",
        "LICENSE",
        "LIC-ADOBE-CC-008",
        "IN_STOCK",
        None,
        json!({"seats": 10, "expiry": "2026-12-31"}),
        None,
        None,
    )
    .await?;

    // App-layer CIs for the CMDB graph (web-server RUNS_ON server-01 etc.).
    let web_server_id = insert_asset(
        &pool,
        "AST-0009",
        "Web Server (nginx)",
        "SERVER",
        "SN-APP-WEB-009",
        "IN_STOCK",
        None,
        json!({"cpu": "4 vCPU", "ram_gb": 8, "storage_gb": 100, "rack": "virtual", "role": "web server"}),
        date(2025, 2, 1),
        date(2028, 2, 1),
    )
    .await?;

    let db_server_id = insert_asset(
        &pool,
        "AST-0010",
        "DB Server (PostgreSQL)",
        "SERVER",
        "SN-APP-DB-010",
        "IN_STOCK",
        None,
        json!({"cpu": "8 vCPU", "ram_gb": 32, "storage_gb": 500, "rack": "virtual", "role": "database server"}),
        date(2025, 2, 1),
        date(2028, 2, 1),
    )
    .await?;

    // ----------------------------------------------------------------- tickets
    // 2 INCIDENT, 2 SERVICE_REQUEST, 1 CHANGE; OPEN/IN_PROGRESS/RESOLVED;
    // LOW/MEDIUM/HIGH/URGENT mix. Tickets #1 and #2 link to assets that are
    // assigned to their requester (requester-asset badge demo).
    insert_ticket(
        &pool,
        "INC-0001",
        "Laptop won't boot after OS update",
        "Employee's Dell Latitude 5440 fails to reach the login screen since yesterday's update.",
        "INCIDENT",
        "HIGH",
        "IN_PROGRESS",
        emp_id,
        Some(agent1_id),
        Some(laptop1_id),
    )
    .await?;

    insert_ticket(
        &pool,
        "INC-0002",
        "Desktop extremely slow - urgent",
        "IT Admin's desktop takes 10+ minutes to respond. Needs immediate attention.",
        "INCIDENT",
        "URGENT",
        "OPEN",
        admin_id,
        Some(agent1_id),
        Some(desktop1_id),
    )
    .await?;

    insert_ticket(
        &pool,
        "INC-0003",
        "Replacement monitor requested",
        "Monitor shows flickering lines; user requests a replacement unit.",
        "SERVICE_REQUEST",
        "LOW",
        "RESOLVED",
        emp_id,
        Some(agent2_id),
        Some(monitor1_id),
    )
    .await?;

    insert_ticket(
        &pool,
        "INC-0004",
        "License seat request for design tool",
        "Support team needs 2 additional Adobe Creative Cloud seats.",
        "SERVICE_REQUEST",
        "MEDIUM",
        "OPEN",
        agent1_id,
        Some(agent2_id),
        Some(license1_id),
    )
    .await?;

    insert_ticket(
        &pool,
        "INC-0005",
        "Schedule OS patching for Server-01",
        "Plan maintenance window to apply security patches to the application host.",
        "CHANGE",
        "MEDIUM",
        "IN_PROGRESS",
        admin_id,
        Some(agent1_id),
        Some(server1_id),
    )
    .await?;

    // -------------------------------------------------------- ci_relationships
    // Direction is parent -> child (downstream). CONNECTS_TO edges point from
    // the switch to each server so impact(switch-01) = server-01 + server-02
    // at depth 1.
    insert_relationship(&pool, web_server_id, server1_id, "RUNS_ON").await?;
    insert_relationship(&pool, db_server_id, server2_id, "RUNS_ON").await?;
    insert_relationship(&pool, switch1_id, server1_id, "CONNECTS_TO").await?;
    insert_relationship(&pool, switch1_id, server2_id, "CONNECTS_TO").await?;

    // ------------------------------------------------------------------ report
    println!("Seeding complete. Row counts:");
    for table in ["users", "assets", "tickets", "ci_relationships", "audit_logs"] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await?;
        println!("  {table}: {count}");
    }
    println!("Login credentials (all users): {DEMO_PASSWORD}");

    Ok(())
}

fn date(y: i32, m: u32, d: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(y, m, d)
}

async fn insert_user(
    pool: &PgPool,
    email: &str,
    name: &str,
    role: &str,
    department: &str,
) -> Result<Uuid, sqlx::Error> {
    let password_hash = auth::hash_password(DEMO_PASSWORD)
        .map_err(|e| sqlx::Error::Protocol(format!("hash failed: {e}")))?;
    Ok(sqlx::query_scalar(
        "INSERT INTO users (email, name, role, department, password_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(email)
    .bind(name)
    .bind(role)
    .bind(department)
    .bind(password_hash)
    .fetch_one(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
async fn insert_asset(
    pool: &PgPool,
    asset_tag: &str,
    name: &str,
    category: &str,
    serial_number: &str,
    status: &str,
    assigned_to_user_id: Option<Uuid>,
    specs: serde_json::Value,
    purchase_date: Option<NaiveDate>,
    warranty_expiry: Option<NaiveDate>,
) -> Result<Uuid, sqlx::Error> {
    Ok(sqlx::query_scalar(
        "INSERT INTO assets (asset_tag, name, category, serial_number, status, assigned_to_user_id, specs, purchase_date, warranty_expiry) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    )
    .bind(asset_tag)
    .bind(name)
    .bind(category)
    .bind(serial_number)
    .bind(status)
    .bind(assigned_to_user_id)
    .bind(specs)
    .bind(purchase_date)
    .bind(warranty_expiry)
    .fetch_one(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
async fn insert_ticket(
    pool: &PgPool,
    ticket_number: &str,
    title: &str,
    description: &str,
    ticket_type: &str,
    priority: &str,
    status: &str,
    requester_id: Uuid,
    assignee_id: Option<Uuid>,
    asset_id: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    Ok(sqlx::query_scalar(
        "INSERT INTO tickets (ticket_number, title, description, ticket_type, priority, status, requester_id, assignee_id, asset_id) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    )
    .bind(ticket_number)
    .bind(title)
    .bind(description)
    .bind(ticket_type)
    .bind(priority)
    .bind(status)
    .bind(requester_id)
    .bind(assignee_id)
    .bind(asset_id)
    .fetch_one(pool)
    .await?)
}

async fn insert_relationship(
    pool: &PgPool,
    parent_asset_id: Uuid,
    child_asset_id: Uuid,
    relationship_type: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ci_relationships (parent_asset_id, child_asset_id, relationship_type) \
         VALUES ($1, $2, $3)",
    )
    .bind(parent_asset_id)
    .bind(child_asset_id)
    .bind(relationship_type)
    .execute(pool)
    .await?;
    Ok(())
}
