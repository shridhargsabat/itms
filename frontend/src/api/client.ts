import type {
  Asset,
  AuditLogEntry,
  AuthUser,
  CreateAssetInput,
  CreateTicketInput,
  CreateUserInput,
  DashboardMetrics,
  ImpactResult,
  LoginResponse,
  LookupOption,
  MasterFamily,
  MastersMap,
  Ticket,
  Topology,
  UpdateUserInput,
  UserRecord,
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
  const res = await apiFetchRaw(path, init);
  // 204 No Content (e.g. DELETE) has no body — don't try to parse it.
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

/** Raw fetch with auth + 401/error handling — returns the Response so headers (X-Total-Count) can be read. */
async function apiFetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // GETs hang forever on iOS when the service worker's CacheStorage stalls
  // (permanent loading skeletons). Never wait longer than 20s: a timeout
  // surfaces as a normal fetch error the query layer can retry/show.
  // Mutations are exempt — aborting a POST client-side while the server
  // still processes it invites double-submits.
  const method = (init.method ?? 'GET').toUpperCase();
  const signal =
    method === 'GET' ? (init.signal ?? AbortSignal.timeout(20_000)) : init.signal;

  const res = await fetch(`/api/v1${path}`, { ...init, headers, signal });

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
  return res;
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
export const getAuditLog = (params?: {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return apiFetchCount<AuditLogEntry>(`/audit/log${qs ? `?${qs}` : ''}`);
};

// ---- assets ----
export interface ListResult<T> {
  items: T[];
  total: number;
}

/** Fetch with the X-Total-Count header (lists that support pagination). */
async function apiFetchCount<T>(path: string): Promise<ListResult<T>> {
  const res = await apiFetchRaw(path);
  const total = Number(res.headers.get('x-total-count')) || 0;
  return { items: (await res.json()) as T[], total };
}

export const listAssets = (params?: { search?: string; category?: string; status?: string; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.category) q.set('category', params.category);
  if (params?.status) q.set('status', params.status);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return apiFetchCount<Asset>(`/assets${qs ? `?${qs}` : ''}`);
};
export const createAsset = (input: CreateAssetInput) =>
  apiFetch<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) });
export const assignAsset = (assetId: string, userId: string | null) =>
  apiFetch<Asset>(`/assets/${assetId}/assign`, { method: 'PATCH', body: JSON.stringify({ assigned_to_user_id: userId }) });

// ---- CSV import / export ----
export interface ImportFailure {
  row: number;
  error: string;
  data: Record<string, string>;
}

export interface ImportResult {
  imported: number;
  failed: ImportFailure[];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** POST raw CSV text; backend validates per row and returns partial success. */
export const importAssetsCsv = (csvText: string) =>
  apiFetch<ImportResult>('/assets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csvText,
  });

/** Download the filtered asset registry as assets.csv (mirrors listAssets filters). */
export const exportAssetsCsv = async (params?: {
  search?: string;
  category?: string;
  status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.category) q.set('category', params.category);
  if (params?.status) q.set('status', params.status);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  const res = await apiFetchRaw(`/assets/export${qs ? `?${qs}` : ''}`);
  downloadBlob(await res.blob(), 'assets.csv');
};

/** Download the filtered ticket list as tickets.csv (mirrors listTickets filters). */
export const exportTicketsCsv = async (params?: {
  status?: string;
  priority?: string;
  type?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  const res = await apiFetchRaw(`/tickets/export${qs ? `?${qs}` : ''}`);
  downloadBlob(await res.blob(), 'tickets.csv');
};

// ---- tickets ----
export const listTickets = (params?: { status?: string; priority?: string; type?: string; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return apiFetchCount<Ticket>(`/tickets${qs ? `?${qs}` : ''}`);
};
export const createTicket = (input: CreateTicketInput) =>
  apiFetch<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(input) });
export const patchTicketStatus = (ticketId: string, status: string) =>
  apiFetch<Ticket>(`/tickets/${ticketId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

// ---- cmdb ----
export const getTopology = () => apiFetch<Topology>('/cmdb/topology');
export const getImpact = (assetId: string) => apiFetch<ImpactResult>(`/cmdb/impact/${assetId}`);

// ---- users master ----
export const listUsers = (params?: { search?: string; role?: string; department?: string; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.role) q.set('role', params.role);
  if (params?.department) q.set('department', params.department);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return apiFetchCount<UserRecord>(`/users${qs ? `?${qs}` : ''}`);
};
export const createUser = (input: CreateUserInput) =>
  apiFetch<UserRecord>('/users', { method: 'POST', body: JSON.stringify(input) });
export const updateUser = (userId: string, input: UpdateUserInput) =>
  apiFetch<UserRecord>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(input) });

// ---- masters ----
export const getMasters = () => apiFetch<MastersMap>('/masters');
export const createMasterOption = (input: {
  family: MasterFamily;
  code: string;
  label: string;
  sort_order?: number;
}) => apiFetch<LookupOption>('/masters', { method: 'POST', body: JSON.stringify(input) });
export const updateMasterOption = (
  optionId: string,
  input: { label?: string; sort_order?: number; active?: boolean },
) => apiFetch<LookupOption>(`/masters/${optionId}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteMasterOption = (optionId: string) =>
  apiFetch<void>(`/masters/${optionId}`, { method: 'DELETE' });
