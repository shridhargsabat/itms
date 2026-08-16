export type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'MAINTENANCE' | 'RETIRED';
export type AssetCategory =
  | 'LAPTOP'
  | 'DESKTOP'
  | 'SERVER'
  | 'NETWORK_DEVICE'
  | 'MONITOR'
  | 'LICENSE';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketType = 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string;
}

/** Master lookup option (lookup_options row from the API). */
export interface LookupOption {
  id: string;
  family: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export type MasterFamily =
  | 'department'
  | 'asset_category'
  | 'ticket_type'
  | 'ticket_priority'
  | 'ticket_status';

export type MastersMap = Record<MasterFamily, LookupOption[]>;

/** User row for the Users master (never contains password fields). */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string;
  active: boolean;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: string;
  department: string;
  password: string;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: string;
  department?: string;
  active?: boolean;
  password?: string;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  user: AuthUser;
}

export const ASSET_STATUSES: AssetStatus[] = ['IN_STOCK', 'ASSIGNED', 'MAINTENANCE', 'RETIRED'];
export const ASSET_CATEGORIES: AssetCategory[] = [
  'LAPTOP',
  'DESKTOP',
  'SERVER',
  'NETWORK_DEVICE',
  'MONITOR',
  'LICENSE',
];
export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
export const TICKET_TYPES: TicketType[] = ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE'];
export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/** One GROUP BY bucket of a dashboard breakdown (key = priority/status code). */
export interface MetricBucket {
  key: string;
  count: number;
}

export interface DashboardMetrics {
  overdue_tickets: number;
  asset_count: number;
  open_tickets: number;
  high_priority_count: number;
  in_stock_count: number;
  warranty_alerts_count: number;
  onboarding_overdue: number;
  open_requests: number;
  license_alerts: number;
  tickets_by_priority: MetricBucket[];
  assets_by_status: MetricBucket[];
}

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  serial_number: string | null;
  status: AssetStatus;
  assigned_to_user_id: string | null;
  assigned_user_name: string | null;
  specs: Record<string, unknown>;
  purchase_date: string | null;
  warranty_expiry: string | null;
  unit_cost: number | null;
  expected_eol: string | null;
  created_at: string;
  updated_at: string;
  current_value?: number | null;
}

export interface LifecycleEvent {
  id: string;
  asset_id: string;
  from_status: AssetStatus | null;
  to_status: AssetStatus;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface WarrantyAlert {
  id: string;
  asset_tag: string;
  name: string;
  status: AssetStatus;
  warranty_expiry: string | null;
  days_left: number | null;
}

export interface UpdateAssetInput {
  name?: string;
  category?: string;
  serial_number?: string;
  status?: string;
  purchase_date?: string | null;
  warranty_expiry?: string | null;
  unit_cost?: number | null;
  expected_eol?: string | null;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  ticket_type: TicketType;
  priority: Priority;
  status: TicketStatus;
  source?: string;
  sla_due_at: string | null;
  sla_escalated_at: string | null;
  requester_id: string;
  requester_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  asset_id: string | null;
  asset_tag: string | null;
  asset_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopologyNode {
  id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  status: AssetStatus;
}

export interface TopologyEdge {
  id: string;
  parent_asset_id: string;
  child_asset_id: string;
  relationship_type: string;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface ImpactedAsset {
  asset_id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  depth: number;
}

export interface ImpactResult {
  root_asset_id: string;
  impact_count: number;
  impacted: ImpactedAsset[];
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  diff: Record<string, unknown>;
  created_at: string;
}

export interface CreateAssetInput {
  name: string;
  category: AssetCategory;
  asset_tag?: string;
  serial_number?: string;
  status?: AssetStatus;
  specs?: Record<string, unknown>;
  purchase_date?: string;
  warranty_expiry?: string;
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  ticket_type: TicketType;
  priority: Priority;
  requester_id?: string;
  asset_id?: string;
}

// ── Onboarding / offboarding (P0-1, issue #50) ──────────────────────────────

export type OnboardingEventType = 'ONBOARDING' | 'OFFBOARDING';
export type OnboardingStatus = 'OPEN' | 'CLOSED';
export type OnboardingTaskCategory = 'ASSET' | 'LICENSE' | 'ACCESS' | 'RETURN' | 'DATA_WIPE' | 'OTHER';
export type OnboardingTaskStatus = 'PENDING' | 'DONE';

export interface OnboardingEvent {
  id: string;
  event_type: OnboardingEventType;
  person_name: string;
  person_email: string;
  start_date: string | null;
  notes: string | null;
  status: OnboardingStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
}

export interface OnboardingTask {
  id: string;
  event_id: string;
  title: string;
  category: OnboardingTaskCategory;
  due_date: string | null;
  status: OnboardingTaskStatus;
  asset_id: string | null;
  asset_tag: string | null;
  note: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface OnboardingDetail {
  event: OnboardingEvent;
  tasks: OnboardingTask[];
}

export interface CreateTaskInput {
  title: string;
  category?: OnboardingTaskCategory;
  due_date?: string | null;
  asset_id?: string | null;
  note?: string | null;
}

export interface CreateOnboardingInput {
  event_type: OnboardingEventType;
  person_name: string;
  person_email: string;
  start_date?: string | null;
  notes?: string | null;
  tasks?: CreateTaskInput[];
}

export interface UpdateTaskInput {
  title?: string;
  category?: OnboardingTaskCategory;
  due_date?: string | null;
  asset_id?: string | null;
  note?: string | null;
  status?: OnboardingTaskStatus;
}

// ── Service catalog + requests (P0-3, issue #51) ────────────────────────────

export interface CatalogFormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date';
  required?: boolean;
  options?: string[];
}

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  approval_required: boolean;
  form_fields: CatalogFormField[];
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type RequestStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type RequestPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface ServiceRequest {
  id: string;
  request_number: string;
  catalog_item_id: string;
  requester_id: string;
  subject: string;
  details: Record<string, unknown>;
  priority: RequestPriority;
  status: RequestStatus;
  assignee_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  requester_name?: string | null;
  assignee_name?: string | null;
  catalog_name?: string | null;
  catalog_code?: string | null;
}

export interface CreateRequestInput {
  catalog_item_id: string;
  subject: string;
  details?: Record<string, unknown>;
  priority?: RequestPriority;
}

// ── License register (P0-2, issue #38) ──────────────────────────────────────

export type LicenseType = 'SUBSCRIPTION' | 'PERPETUAL' | 'OPEN_SOURCE';

export interface License {
  id: string;
  name: string;
  vendor: string | null;
  license_type: LicenseType;
  seats_total: number;
  seats_used: number;
  cost_per_seat: number | null;
  cost_total: number | null;
  currency: string;
  expiry_date: string | null;
  renewal_cost: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LicenseAllocation {
  id: string;
  license_id: string;
  user_id: string;
  assigned_at: string;
  revoked_at: string | null;
  user_name?: string | null;
  user_email?: string | null;
}

export interface LicenseAlerts {
  expired: License[];
  expiring_30: License[];
  expiring_60: License[];
  expiring_90: License[];
}

export interface CreateLicenseInput {
  name: string;
  vendor?: string | null;
  license_type?: LicenseType;
  seats_total?: number;
  cost_per_seat?: number | null;
  cost_total?: number | null;
  currency?: string;
  expiry_date?: string | null;
  renewal_cost?: number | null;
  notes?: string | null;
}

// ── Ticket comments + attachments (P1-1, issue #42) ─────────────────────────

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  author_name?: string | null;
  author_role?: string | null;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  uploader_id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  storage_key: string;
  created_at: string;
  uploader_name?: string | null;
}

export interface TicketTimelineEntry {
  kind: 'change';
  actor: string;
  action: string;
  at: string;
  details: Record<string, unknown>;
}

export interface TicketTimeline {
  comments: TicketComment[];
  changes: TicketTimelineEntry[];
  attachments: TicketAttachment[];
}

// ── Notifications (P1-2, issue #43) ─────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  ref_type: string | null;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
}

// ── SLA (P1-4, issue #45) ────────────────────────────────────────────────────

export interface SlaPolicy {
  [priority: string]: { hours: number; label: string };
}

// ── Knowledge base (P1-7, issue #48) ────────────────────────────────────────

export interface KbArticle {
  id: string;
  ticket_type: string;
  title: string;
  body: string;
  source_ticket_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
}

export interface CannedResponse {
  id: string;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

// ── Ticket templates (#46) ──────────────────────────────────────────────────

export interface TicketTemplate {
  id: string;
  name: string;
  ticket_type: string;
  priority: string;
  description: string;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
}
