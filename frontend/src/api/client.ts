import type {
  Asset,
  AuditLogEntry,
  AuthUser,
  Notification,
  TicketAttachment,
  TicketComment,
  TicketTimeline,
  CatalogItem,
  CreateAssetInput,
  CreateLicenseInput,
  CreateOnboardingInput,
  CreateRequestInput,
  CreateTicketInput,
  CreateTaskInput,
  CreateUserInput,
  DashboardMetrics,
  ImpactResult,
  License,
  LicenseAlerts,
  LicenseAllocation,
  LifecycleEvent,
  LoginResponse,
  LookupOption,
  OnboardingDetail,
  OnboardingEvent,
  OnboardingTask,
  ServiceRequest,
  UpdateTaskInput,
  MasterFamily,
  MastersMap,
  SlaPolicy,
  Ticket,
  Topology,
  UpdateAssetInput,
  UpdateUserInput,
  UserRecord,
  WarrantyAlert,
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

// P1-6 password reset flow
export const forgotPassword = (email: string) =>
  apiFetch<{ ok: boolean }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const resetPassword = (body: { token: string; new_password: string }) =>
  apiFetch<{ ok: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const changePassword = (body: { current_password: string; new_password: string }) =>
  apiFetch<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(body),
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
export const updateAsset = (assetId: string, input: UpdateAssetInput) =>
  apiFetch<Asset>(`/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(input) });
export const getAssetLifecycle = (assetId: string) =>
  apiFetch<LifecycleEvent[]>(`/assets/${assetId}/lifecycle`);
export const getWarrantyAlerts = (scope?: 'all' | 'expired' | 'expiring') =>
  apiFetch<WarrantyAlert[]>(`/assets/alerts${scope ? `?scope=${scope}` : ''}`);

// ---- bulk asset actions ----
export interface BulkResult {
  updated: number;
}
export const bulkUpdateAssetStatus = (ids: string[], status: string) =>
  apiFetch<BulkResult>('/assets/bulk/status', { method: 'PATCH', body: JSON.stringify({ ids, status }) });
export const bulkAssignAssets = (ids: string[], assignedToUserId: string | null) =>
  apiFetch<BulkResult>('/assets/bulk/assign', { method: 'PATCH', body: JSON.stringify({ ids, assigned_to_user_id: assignedToUserId }) });
export const bulkDeleteAssets = (ids: string[]) =>
  apiFetch<BulkResult>('/assets/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) });

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

/** Export the filtered asset registry as assets.csv — pass ids to export a selection. */
export const exportAssetsCsv = async (params?: {
  search?: string;
  category?: string;
  status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  ids?: string[];
}) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.category) q.set('category', params.category);
  if (params?.status) q.set('status', params.status);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  if (params?.ids?.length) q.set('ids', params.ids.join(','));
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
export const listTickets = (params?: { status?: string; priority?: string; type?: string; overdue?: boolean; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  if (params?.overdue) q.set('overdue', 'true');
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

// ── Onboarding / offboarding (P0-1) ─────────────────────────────────────────

export const getOnboardingEvents = (params?: {
  type?: 'ONBOARDING' | 'OFFBOARDING';
  status?: 'OPEN' | 'CLOSED';
  search?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  const qs = q.toString();
  return apiFetch<OnboardingEvent[]>(`/onboarding${qs ? `?${qs}` : ''}`);
};

export const getOnboardingDetail = (id: string) => apiFetch<OnboardingDetail>(`/onboarding/${id}`);

export const createOnboardingEvent = (input: CreateOnboardingInput) =>
  apiFetch<OnboardingEvent>('/onboarding', { method: 'POST', body: JSON.stringify(input) });

export const updateOnboardingEvent = (
  id: string,
  input: { person_name?: string; person_email?: string; start_date?: string | null; notes?: string | null; status?: string },
) => apiFetch<OnboardingEvent>(`/onboarding/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteOnboardingEvent = (id: string) =>
  apiFetch<void>(`/onboarding/${id}`, { method: 'DELETE' });

export const addOnboardingTask = (eventId: string, input: CreateTaskInput) =>
  apiFetch<OnboardingTask>(`/onboarding/${eventId}/tasks`, { method: 'POST', body: JSON.stringify(input) });

export const updateOnboardingTask = (taskId: string, input: UpdateTaskInput) =>
  apiFetch<{ task: OnboardingTask }>(`/onboarding/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteOnboardingTask = (taskId: string) =>
  apiFetch<void>(`/onboarding/tasks/${taskId}`, { method: 'DELETE' });

// ── Service catalog + requests (P0-3) ───────────────────────────────────────

export const getCatalog = () => apiFetch<CatalogItem[]>('/requests/catalog');

export const getRequests = (params?: {
  mine?: boolean;
  pending?: boolean;
  status?: string;
  assignee?: string;
  search?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.mine) q.set('mine', 'true');
  if (params?.pending) q.set('pending', 'true');
  if (params?.status) q.set('status', params.status);
  if (params?.assignee) q.set('assignee', params.assignee);
  if (params?.search) q.set('search', params.search);
  const qs = q.toString();
  return apiFetch<ServiceRequest[]>(`/requests${qs ? `?${qs}` : ''}`);
};

export const createRequest = (input: CreateRequestInput) =>
  apiFetch<ServiceRequest>('/requests', { method: 'POST', body: JSON.stringify(input) });

export const updateRequest = (id: string, input: { status?: string; priority?: string; subject?: string }) =>
  apiFetch<ServiceRequest>(`/requests/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const approveRequest = (id: string) =>
  apiFetch<ServiceRequest>(`/requests/${id}/approve`, { method: 'POST' });

export const rejectRequest = (id: string) =>
  apiFetch<ServiceRequest>(`/requests/${id}/reject`, { method: 'POST' });

// ── License register (P0-2) ─────────────────────────────────────────────────

export const getLicenses = (params?: { search?: string; scope?: string; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.scope) q.set('scope', params.scope);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiFetch<License[]>(`/licenses${qs ? `?${qs}` : ''}`);
};

export const getLicenseAlerts = (scope?: 'all' | 'expired' | 'expiring') =>
  apiFetch<LicenseAlerts>(`/licenses/alerts${scope && scope !== 'all' ? `?scope=${scope}` : ''}`);

export const getLicenseDetail = (id: string) =>
  apiFetch<{ license: License; allocations: LicenseAllocation[] }>(`/licenses/${id}`);

export const createLicense = (input: CreateLicenseInput) =>
  apiFetch<License>('/licenses', { method: 'POST', body: JSON.stringify(input) });

export const updateLicense = (id: string, input: Partial<CreateLicenseInput & { active?: boolean }>) =>
  apiFetch<License>(`/licenses/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteLicense = (id: string) =>
  apiFetch<void>(`/licenses/${id}`, { method: 'DELETE' });

export const assignSeat = (id: string, userId: string) =>
  apiFetch<LicenseAllocation>(`/licenses/${id}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });

export const revokeSeat = (id: string, userId: string) =>
  apiFetch<LicenseAllocation>(`/licenses/${id}/revoke`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });

// ── Ticket comments + attachments (P1-1) ────────────────────────────────────

export const getTicketComments = (ticketId: string) =>
  apiFetch<TicketComment[]>(`/tickets/${ticketId}/comments`);

export const createTicketComment = (ticketId: string, input: { body: string; mentions?: string[] }) =>
  apiFetch<TicketComment>(`/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify(input) });

export const deleteTicketComment = (ticketId: string, commentId: string) =>
  apiFetch<void>(`/tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' });

export const getTicketTimeline = (ticketId: string) =>
  apiFetch<TicketTimeline>(`/tickets/${ticketId}/timeline`);

export const uploadTicketAttachment = async (ticketId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  // FormData needs the browser-set multipart boundary — bypass apiFetchRaw
  // entirely (it forces a JSON Content-Type on any body).
  const token = localStorage.getItem('itms_token');
  const res = await fetch(`/api/v1/tickets/${ticketId}/attachments`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `upload failed: ${res.status}`);
  }
  return res.json() as Promise<TicketAttachment>;
};

export const deleteTicketAttachment = (ticketId: string, attachmentId: string) =>
  apiFetch<void>(`/tickets/${ticketId}/attachments/${attachmentId}`, { method: 'DELETE' });

export const downloadTicketAttachment = async (attachmentId: string) => {
  const token = localStorage.getItem('itms_token');
  const res = await fetch(`/api/v1/attachments/${attachmentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return res.blob();
};

// ── Notifications (P1-2) ────────────────────────────────────────────────────

export const getNotifications = (limit = 50) =>
  apiFetch<Notification[]>(`/notifications?limit=${limit}`);

export const getUnreadCount = () =>
  apiFetch<{ unread: number }>('/notifications/unread-count');

export const markNotificationRead = (id: string) =>
  apiFetch<void>(`/notifications/${id}/read`, { method: 'GET' });

export const markAllNotificationsRead = () =>
  apiFetch<void>('/notifications/read-all', { method: 'GET' });

export const getSlaPolicy = () => apiFetch<SlaPolicy>('/sla/policy');

export const listOverdueTickets = (limit = 10) => apiFetchCount<Ticket>(`/tickets?overdue=true&limit=${limit}`);
