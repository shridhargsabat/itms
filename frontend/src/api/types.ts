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

export interface DashboardMetrics {
  asset_count: number;
  open_tickets: number;
  high_priority_count: number;
  in_stock_count: number;
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
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  ticket_type: TicketType;
  priority: Priority;
  status: TicketStatus;
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
