use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Row models (serde + sqlx::FromRow)
// ---------------------------------------------------------------------------

/// Reserved for future user-facing endpoints (e.g. GET /users); returned by
/// queries once those land, so dead_code is expected for now.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub department: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

/// One row of master data (lookup_options). `family` is one of
/// department | asset_category | ticket_type | ticket_priority | ticket_status.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LookupOption {
    pub id: Uuid,
    pub family: String,
    pub code: String,
    pub label: String,
    pub sort_order: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Asset {
    pub id: Uuid,
    pub asset_tag: String,
    pub name: String,
    pub category: String,
    pub serial_number: String,
    pub status: String,
    pub assigned_to_user_id: Option<Uuid>,
    pub specs: Value,
    pub purchase_date: Option<NaiveDate>,
    pub warranty_expiry: Option<NaiveDate>,
    pub unit_cost: Option<f64>,
    pub expected_eol: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Populated via LEFT JOIN users; NULL when unassigned.
    #[sqlx(default)]
    pub assigned_user_name: Option<String>,
    /// Straight-line depreciation (3y from purchase_date or expected_eol),
    /// computed in SQL; NULL when no cost/date basis exists.
    #[sqlx(default)]
    pub current_value: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Ticket {
    pub id: Uuid,
    pub ticket_number: String,
    pub title: String,
    pub description: String,
    pub ticket_type: String,
    pub priority: String,
    pub status: String,
    pub requester_id: Uuid,
    pub assignee_id: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Populated via LEFT JOINs on users + assets.
    #[sqlx(default)]
    pub requester_name: Option<String>,
    #[sqlx(default)]
    pub assignee_name: Option<String>,
    #[sqlx(default)]
    pub asset_tag: Option<String>,
    #[sqlx(default)]
    pub asset_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CiRelationship {
    pub id: Uuid,
    pub parent_asset_id: Uuid,
    pub child_asset_id: Uuid,
    pub relationship_type: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct AuditLogEntry {
    pub id: Uuid,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub target_type: String,
    pub target_id: Uuid,
    pub diff: Value,
    pub created_at: DateTime<Utc>,
    /// Populated via LEFT JOIN users.
    #[sqlx(default)]
    pub actor_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DashboardMetrics {
    pub asset_count: i64,
    pub open_tickets: i64,
    pub high_priority_count: i64,
    pub in_stock_count: i64,
    /// Assets whose warranty expires within 90 days or has already expired
    /// (excludes RETIRED — same filter as the Warranty view).
    pub warranty_alerts_count: i64,
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateAssetRequest {
    pub name: String,
    pub category: String,
    pub serial_number: String,
    pub status: Option<String>,
    pub specs: Option<Value>,
    pub purchase_date: Option<NaiveDate>,
    pub warranty_expiry: Option<NaiveDate>,
    pub unit_cost: Option<f64>,
    pub expected_eol: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct AssignAssetRequest {
    pub assigned_to_user_id: Option<Uuid>,
}

/// PATCH /assets/{id} — partial update. All fields optional; None = leave
/// unchanged. `status` is validated against the lifecycle transition map.
#[derive(Debug, Deserialize)]
pub struct UpdateAssetRequest {
    pub name: Option<String>,
    pub category: Option<String>,
    pub serial_number: Option<String>,
    pub status: Option<String>,
    pub specs: Option<Value>,
    pub purchase_date: Option<Option<NaiveDate>>,
    pub warranty_expiry: Option<Option<NaiveDate>>,
    pub unit_cost: Option<Option<f64>>,
    pub expected_eol: Option<Option<NaiveDate>>,
}

/// Row from asset_lifecycle_events (+ actor name).
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LifecycleEvent {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub from_status: Option<String>,
    pub to_status: String,
    pub actor_id: Option<Uuid>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub actor_name: Option<String>,
}

/// Warranty alert row: asset + warranty context (computed in SQL).
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WarrantyAlert {
    pub id: Uuid,
    pub asset_tag: String,
    pub name: String,
    pub status: String,
    pub warranty_expiry: Option<NaiveDate>,
    pub days_left: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTicketRequest {
    pub title: String,
    pub description: String,
    pub ticket_type: Option<String>,
    pub priority: Option<String>,
    pub requester_id: Uuid,
    pub assignee_id: Option<Uuid>,
    pub asset_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTicketStatusRequest {
    pub status: String,
}

// ---------------------------------------------------------------------------
// CMDB topology / impact response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TopologyNode {
    pub id: Uuid,
    pub asset_tag: String,
    pub name: String,
    pub category: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct TopologyEdge {
    pub id: Uuid,
    pub parent_asset_id: Uuid,
    pub child_asset_id: Uuid,
    pub relationship_type: String,
}

#[derive(Debug, Serialize)]
pub struct TopologyResponse {
    pub nodes: Vec<TopologyNode>,
    pub edges: Vec<TopologyEdge>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ImpactedAsset {
    pub asset_id: Uuid,
    pub asset_tag: String,
    pub name: String,
    pub category: String,
    pub depth: i32,
}

#[derive(Debug, Serialize)]
pub struct ImpactResponse {
    pub root_asset_id: Uuid,
    pub impact_count: i64,
    pub impacted: Vec<ImpactedAsset>,
}
