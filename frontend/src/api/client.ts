import type {
  Asset,
  AuditLogEntry,
  CreateAssetInput,
  CreateTicketInput,
  DashboardMetrics,
  ImpactResult,
  Ticket,
  TicketStatus,
  Topology,
} from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown; error?: unknown };
      if (body.detail != null) {
        message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      } else if (body.error != null) {
        message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    } catch {
      // non-JSON error body — keep generic message
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const getDashboardMetrics = () => apiFetch<DashboardMetrics>('/dashboard/metrics');

export const listAssets = (params?: { search?: string; category?: string; status?: string }) =>
  apiFetch<Asset[]>(`/assets${qs(params ?? {})}`);

export const createAsset = (body: CreateAssetInput) =>
  apiFetch<Asset>('/assets', { method: 'POST', body: JSON.stringify(body) });

export const assignAsset = (id: string, userIdOrNull: string | null) =>
  apiFetch<Asset>(`/assets/${id}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userIdOrNull }),
  });

export type TicketFilters = Record<string, string | undefined>;

export const listTickets = (params?: TicketFilters) =>
  apiFetch<Ticket[]>(`/tickets${qs(params ?? {})}`);

export const createTicket = (body: CreateTicketInput) =>
  apiFetch<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(body) });

export const patchTicketStatus = (id: string, status: TicketStatus) =>
  apiFetch<Ticket>(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const getTopology = () => apiFetch<Topology>('/cmdb/topology');

export const getImpact = (assetId: string) => apiFetch<ImpactResult>(`/cmdb/impact/${assetId}`);

export const getAuditLog = (limit = 50) => apiFetch<AuditLogEntry[]>(`/audit/log?limit=${limit}`);
