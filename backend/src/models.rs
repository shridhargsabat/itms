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
    /// #39: vendor master link (NULL until a vendor is assigned)
    #[sqlx(default)]
    pub vendor_id: Option<Uuid>,
    #[sqlx(default)]
    pub vendor_name: Option<String>,
    /// #40: current location (NULL until placed); name is the formatted
    /// "Site / Building / Floor / Room" path computed in SQL.
    #[sqlx(default)]
    pub location_id: Option<Uuid>,
    #[sqlx(default)]
    pub location_name: Option<String>,
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
    pub source: String,
    pub requester_id: Uuid,
    pub assignee_id: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // P1-4 SLA (only in TICKET_SELECT-based queries; #[sqlx(default)] keeps
    // any other SELECT mapping into Ticket working)
    #[sqlx(default)]
    pub sla_due_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub sla_escalated_at: Option<DateTime<Utc>>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct MetricBucket {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardMetrics {
    pub asset_count: i64,
    pub open_tickets: i64,
    pub high_priority_count: i64,
    pub in_stock_count: i64,
    /// Assets whose warranty expires within 90 days or has already expired
    /// (excludes RETIRED — same filter as the Warranty view).
    pub warranty_alerts_count: i64,
    /// Open onboarding/offboarding events with at least one overdue task.
    pub onboarding_overdue: i64,
    /// Open service requests (SUBMITTED/APPROVED/IN_PROGRESS).
    pub open_requests: i64,
    /// Active licenses expiring within 90 days or already expired.
    pub license_alerts: i64,
    /// Open/IN_PROGRESS tickets whose SLA deadline has passed.
    pub overdue_tickets: i64,
    /// Open tickets grouped by priority (sums to open_tickets).
    pub tickets_by_priority: Vec<MetricBucket>,
    /// Assets grouped by status (IN_STOCK bucket equals in_stock_count).
    pub assets_by_status: Vec<MetricBucket>,
}

// scalar-only FromRow target (keeps the existing single SELECT untouched;
// FromRow cannot decode a Vec field, hence the split)
#[derive(Debug, sqlx::FromRow)]
pub struct DashboardMetricsScalars {
    pub asset_count: i64,
    pub open_tickets: i64,
    pub high_priority_count: i64,
    pub in_stock_count: i64,
    pub warranty_alerts_count: i64,
    pub onboarding_overdue: i64,
    pub open_requests: i64,
    pub license_alerts: i64,
    pub overdue_tickets: i64,
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
    /// #39: vendor master link (validated against vendors table)
    pub vendor_id: Option<Uuid>,
    /// #40: optional initial location
    pub location_id: Option<Uuid>,
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
    #[serde(default, deserialize_with = "double_option")]
    pub purchase_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub warranty_expiry: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub unit_cost: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub expected_eol: Option<Option<NaiveDate>>,
    /// #39: None = unchanged, Some(None) = clear the vendor link
    #[serde(default, deserialize_with = "double_option")]
    pub vendor_id: Option<Option<Uuid>>,
    /// #40: None = unchanged, Some(None) = unplaced.
    #[serde(default, deserialize_with = "double_option")]
    pub location_id: Option<Option<Uuid>>,
}

/// serde does NOT distinguish `"field": null` (→ None, same as absent) in
/// Option<Option<T>> — JSON null collapses into the outer None, so explicit
/// "clear this field" becomes indistinguishable from "leave unchanged".
/// This wrapper forces null → Some(None); absent → None (via #[serde(default)]).
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(d)?))
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

// ── Onboarding / offboarding (P0-1, issue #50) ──────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct OnboardingEvent {
    pub id: Uuid,
    pub event_type: String,
    pub person_name: String,
    pub person_email: String,
    pub start_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub status: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// task progress columns (list queries only)
    #[sqlx(default)]
    pub total_tasks: i64,
    #[sqlx(default)]
    pub done_tasks: i64,
    #[sqlx(default)]
    pub overdue_tasks: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct OnboardingTask {
    pub id: Uuid,
    pub event_id: Uuid,
    pub title: String,
    pub category: String,
    pub due_date: Option<NaiveDate>,
    pub status: String,
    pub asset_id: Option<Uuid>,
    pub note: Option<String>,
    pub completed_by: Option<Uuid>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    /// joined for display (list queries only)
    #[sqlx(default)]
    pub asset_tag: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOnboardingRequest {
    pub event_type: String,
    pub person_name: String,
    pub person_email: String,
    pub start_date: Option<NaiveDate>,
    pub notes: Option<String>,
    /// optional custom task list; when omitted, the standard checklist for
    /// the event type is generated server-side
    #[serde(default)]
    pub tasks: Option<Vec<CreateTaskInput>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub category: String,
    pub due_date: Option<NaiveDate>,
    pub asset_id: Option<Uuid>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOnboardingRequest {
    pub person_name: Option<String>,
    pub person_email: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub category: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub asset_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "double_option")]
    pub note: Option<Option<String>>,
    pub status: Option<String>,
}

// ── Service catalog + requests (P0-3, issue #51) ────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CatalogItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub approval_required: bool,
    pub form_fields: Value,
    pub active: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServiceRequest {
    pub id: Uuid,
    pub request_number: String,
    pub catalog_item_id: Uuid,
    pub requester_id: Uuid,
    pub subject: String,
    pub details: Value,
    pub priority: String,
    pub status: String,
    pub assignee_id: Option<Uuid>,
    pub approved_by: Option<Uuid>,
    pub approved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// joined display fields (list queries only)
    #[sqlx(default)]
    pub requester_name: Option<String>,
    #[sqlx(default)]
    pub assignee_name: Option<String>,
    #[sqlx(default)]
    pub catalog_name: Option<String>,
    #[sqlx(default)]
    pub catalog_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCatalogRequest {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub approval_required: bool,
    #[serde(default)]
    pub form_fields: Value,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCatalogRequest {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub category: Option<String>,
    pub approval_required: Option<bool>,
    pub form_fields: Option<Value>,
    pub active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRequestInput {
    pub catalog_item_id: Uuid,
    pub subject: String,
    pub details: Option<Value>,
    #[serde(default = "default_priority")]
    pub priority: String,
}

fn default_priority() -> String {
    "MEDIUM".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequestInput {
    pub status: Option<String>,
    pub assignee_id: Option<Option<Uuid>>,
    pub priority: Option<String>,
    pub subject: Option<String>,
}

// ── License register (P0-2, issue #38) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct License {
    pub id: Uuid,
    pub name: String,
    pub vendor: Option<String>,
    pub license_type: String,
    pub seats_total: i32,
    pub seats_used: i64,
    pub cost_per_seat: Option<f64>,
    pub cost_total: Option<f64>,
    pub currency: String,
    pub expiry_date: Option<NaiveDate>,
    pub renewal_cost: Option<f64>,
    pub notes: Option<String>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LicenseAllocation {
    pub id: Uuid,
    pub license_id: Uuid,
    pub user_id: Uuid,
    pub assigned_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub user_name: Option<String>,
    #[sqlx(default)]
    pub user_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLicenseRequest {
    pub name: String,
    pub vendor: Option<String>,
    #[serde(default = "default_license_type")]
    pub license_type: String,
    #[serde(default = "default_one")]
    pub seats_total: i32,
    pub cost_per_seat: Option<f64>,
    pub cost_total: Option<f64>,
    #[serde(default)]
    pub currency: String,
    pub expiry_date: Option<NaiveDate>,
    pub renewal_cost: Option<f64>,
    pub notes: Option<String>,
}

fn default_one() -> i32 { 1 }

fn default_license_type() -> String {
    "SUBSCRIPTION".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateLicenseRequest {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub vendor: Option<Option<String>>,
    pub license_type: Option<String>,
    pub seats_total: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    pub cost_per_seat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub cost_total: Option<Option<f64>>,
    pub currency: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub expiry_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub renewal_cost: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AssignSeatRequest {
    pub user_id: Uuid,
}

// ── Ticket comments + attachments (P1-1, issue #42) ─────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TicketComment {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub mentions: Value,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub author_name: Option<String>,
    #[sqlx(default)]
    pub author_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TicketAttachment {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub uploader_id: Uuid,
    pub file_name: String,
    pub content_type: Option<String>,
    pub size_bytes: i64,
    pub storage_key: String,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub uploader_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub body: String,
    #[serde(default)]
    pub mentions: Vec<Uuid>,
}

// ── Notifications (P1-2, issue #43) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub ref_type: Option<String>,
    pub ref_id: Option<Uuid>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}


// ── #40 multi-location ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Location {
    pub id: Uuid,
    pub site: String,
    pub building: String,
    pub floor: String,
    pub room: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LocationWithCount {
    pub id: Uuid,
    pub site: String,
    pub building: String,
    pub floor: String,
    pub room: String,
    pub created_at: DateTime<Utc>,
    pub asset_count: i64,
}

/// One entry of an asset's move history (joined names for display).
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct AssetMove {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub from_location_id: Option<Uuid>,
    pub to_location_id: Option<Uuid>,
    #[sqlx(default)]
    pub from_location_name: Option<String>,
    #[sqlx(default)]
    pub to_location_name: Option<String>,
    pub actor_id: Option<Uuid>,
    #[sqlx(default)]
    pub actor_name: Option<String>,
    pub note: String,
    pub created_at: DateTime<Utc>,
}
