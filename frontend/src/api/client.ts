import type {
  Asset,
  AuditLogEntry,
  AuthUser,
  CreateAssetInput,
  CreateTicketInput,
  DashboardMetrics,
  ImpactResult,
  LoginResponse,
  Ticket,
  Topology,
} from '@/api/types';

const TOKEN_KEY = 'itms_token';
const USER_KEY = 'itms_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCachedUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api/v1${path}`, { ...init, headers });

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ---- auth ----
export const login = (email: string, password: string) =>
  apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const logout = () =>
  apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }).catch(() => ({ ok: false }));

export const me = () => apiFetch<AuthUser>('/auth/me');

// ---- dashboard ----
export const getDashboardMetrics = () => apiFetch<DashboardMetrics>('/dashboard/metrics');
export const getAuditLog = (limit = 50) => apiFetch<AuditLogEntry[]>(`/audit/log?limit=${limit}`);

// ---- assets ----
export const listAssets = (params?: { search?: string; category?: string; status?: string }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.category) q.set('category', params.category);
  if (params?.status) q.set('status', params.status);
  const qs = q.toString();
  return apiFetch<Asset[]>(`/assets${qs ? `?${qs}` : ''}`);
};
export const createAsset = (input: CreateAssetInput) =>
  apiFetch<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) });
export const assignAsset = (assetId: string, userId: string | null) =>
  apiFetch<Asset>(`/assets/${assetId}/assign`, { method: 'PATCH', body: JSON.stringify({ assigned_to_user_id: userId }) });

// ---- tickets ----
export const listTickets = (params?: { status?: string; priority?: string; type?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  const qs = q.toString();
  return apiFetch<Ticket[]>(`/tickets${qs ? `?${qs}` : ''}`);
};
export const createTicket = (input: CreateTicketInput) =>
  apiFetch<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(input) });
export const patchTicketStatus = (ticketId: string, status: string) =>
  apiFetch<Ticket>(`/tickets/${ticketId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

// ---- cmdb ----
export const getTopology = () => apiFetch<Topology>('/cmdb/topology');
export const getImpact = (assetId: string) => apiFetch<ImpactResult>(`/cmdb/impact/${assetId}`);
