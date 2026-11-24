import type {
  Asset,
  AssetDocument,
  AuditLogEntry,
  AuthUser,
  CannedResponse,
  KbArticle,
  Notification,
  TicketTemplate,
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
  InvoiceParseResult,
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
  UpdateTicketInput,
  UpdateUserInput,
  UserRecord,
  LocationWithCount,
  LocationInput,
  AssetMove,
  Location,
  OAuthConfig,
  OAuthConfigUpdate,
  OAuthStatus,
  WarrantyAlert,
  QrScanResult,
  RepeatIncident,
  Vendor,
  VendorClaim,
  VendorInput,
  ClaimInput,
  VelocityResponse,
} from '@/api/types';

const TOKEN_KEY = 'itms_token';
const USER_KEY = 'itms_user';
// Wave-2a: client-side session lifetime — 30-min idle timeout + absolute cap.
// The server TTL (7d) is the backstop; these bound a stolen/forgotten tab.
const SESSION_STARTED_KEY = 'itms_session_started_at';
const LAST_ACTIVITY_KEY = 'itms_last_activity';
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

export type SessionFreshness = 'ok' | 'idle' | 'absolute';

/**
 * Pure session-lifetime evaluator (unit-tested, no storage access).
 * Missing/unparseable stamps (pre-wave-2a sessions) get grace — the caller
 * initializes them instead of nuking a live session on upgrade.
 */
export function evaluateSessionFreshness(
  startedAt: number | null,
  lastActivity: number | null,
  now: number,
): SessionFreshness {
  if (startedAt == null || lastActivity == null) return 'ok';
  if (now - startedAt > ABSOLUTE_SESSION_MS) return 'absolute';
  if (now - lastActivity > IDLE_TIMEOUT_MS) return 'idle';
  return 'ok';
}

function readTs(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function stampSession(now: number) {
  localStorage.setItem(SESSION_STARTED_KEY, String(now));
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

function touchActivity(now: number) {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  stampSession(Date.now());
}

/**
 * Wave-2a: async so callers can AWAIT the api-* cache purge before navigating.
 * Storage is cleared synchronously (token gone immediately); only the
 * CacheStorage purge is awaited, retried once, then warned on failure.
 */
export async function clearSession(): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_STARTED_KEY);
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  // #92: purge cached API responses (api-fresh/api-catalog hold authed data —
  // tickets, assets, CMDB, audits) so nothing sensitive survives logout.
  if ('caches' in window) {
    const purge = () =>
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith('api-')).map((k) => caches.delete(k))),
        );
    try {
      await purge();
    } catch {
      try {
        await purge(); // retry once — CacheStorage can stall transiently (iOS)
      } catch (err) {
        console.warn('itms: api cache purge failed after retry', err);
      }
    }
  }
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

/**
 * Session-establishing / public auth paths: exempt from idle/absolute
 * enforcement (a stale attached token must not nuke a fresh login, a logout
 * must still revoke server-side, public reads carry no session to expire).
 * NOTE: /auth/me is deliberately NOT exempt — it's the RequireAuth gate.
 */
function isSessionBootstrapPath(path: string): boolean {
  return (
    path.startsWith('/auth/login') ||
    path.startsWith('/auth/demo') ||
    path.startsWith('/auth/logout') ||
    path.startsWith('/auth/oauth') ||
    path.startsWith('/auth/forgot-password') ||
    path.startsWith('/auth/reset-password')
  );
}

/**
 * Wave-2a lifetime gate: throws 401 (after awaiting the purge + bouncing to
 * /login) when the session blew the idle timeout or absolute cap. Happy path
 * just stamps activity. Missing stamps (pre-wave-2a sessions) initialize
 * instead of nuking.
 */
async function enforceSessionFreshness(): Promise<void> {
  const now = Date.now();
  const started = readTs(SESSION_STARTED_KEY);
  const last = readTs(LAST_ACTIVITY_KEY);
  if (started == null || last == null) {
    stampSession(now);
    return;
  }
  const freshness = evaluateSessionFreshness(started, last, now);
  if (freshness === 'ok') {
    touchActivity(now);
    return;
  }
  await clearSession();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
  throw new ApiError(
    401,
    freshness === 'idle'
      ? 'Session idle too long — please sign in again'
      : 'Session expired — please sign in again',
  );
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
  // Wave-2a: did THIS request actually carry credentials? The 401 self-nuke
  // and the idle/absolute enforcement below apply only to authed requests —
  // public auth reads (oauth status, forgot-password) must never wipe.
  const sentAuth = headers.has('Authorization');

  // Wave-2a client-side lifetime: enforce on authed, non-bootstrap requests.
  if (sentAuth && !isSessionBootstrapPath(path)) {
    await enforceSessionFreshness();
  }

  // GETs hang forever on iOS when the service worker's CacheStorage stalls
  // (permanent loading skeletons). Never wait longer than 20s: a timeout
  // surfaces as a normal fetch error the query layer can retry/show.
  // Mutations are exempt — aborting a POST client-side while the server
  // still processes it invites double-submits.
  const method = (init.method ?? 'GET').toUpperCase();
  const signal =
    method === 'GET' ? (init.signal ?? AbortSignal.timeout(20_000)) : init.signal;

  // Wave-2a: always send cookies — the httpOnly itms_session rides along
  // while the Bearer header keeps transitional API clients working.
  const res = await fetch(`/api/v1${path}`, { ...init, headers, signal, credentials: 'include' });

  if (res.status === 401 && sentAuth && !path.startsWith('/auth/login')) {
    await clearSession();
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

/** #87: server-side demo account — no credentials in the JS bundle. */
export const demoLogin = () => apiFetch<LoginResponse>('/auth/demo', { method: 'POST' });

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

export const listKbArticles = (params?: { ticket_type?: string; search?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params?.ticket_type) q.set('ticket_type', params.ticket_type);
  if (params?.search) q.set('search', params.search);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiFetchCount<KbArticle>(`/kb/articles${qs ? `?${qs}` : ''}`);
};

export const getKbArticle = (id: string) => apiFetch<KbArticle>(`/kb/articles/${id}`);

export const createKbArticle = (body: { ticket_type?: string; title: string; body: string }) =>
  apiFetch<KbArticle>('/kb/articles', { method: 'POST', body: JSON.stringify(body) });

export const updateKbArticle = (id: string, body: { ticket_type?: string; title?: string; body?: string }) =>
  apiFetch<KbArticle>(`/kb/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) });

export const deleteKbArticle = (id: string) => apiFetch<void>(`/kb/articles/${id}`, { method: 'DELETE' });

export const listCanned = () => apiFetch<CannedResponse[]>('/kb/canned');

export const createCanned = (body: { title: string; body: string }) =>
  apiFetch<CannedResponse>('/kb/canned', { method: 'POST', body: JSON.stringify(body) });

export const deleteCanned = (id: string) => apiFetch<void>(`/kb/canned/${id}`, { method: 'DELETE' });

export const convertTicketToArticle = (ticketId: string, body: { title?: string; body?: string }) =>
  apiFetch<KbArticle>(`/tickets/${ticketId}/convert-to-article`, { method: 'POST', body: JSON.stringify(body) });

export const suggestArticles = (query: string) =>
  apiFetch<KbArticle[]>('/kb/suggest?search=' + encodeURIComponent(query));

export const listTemplates = (activeOnly = false) =>
  apiFetch<TicketTemplate[]>('/templates' + (activeOnly ? '?active_only=1' : ''));

export const createTemplate = (body: { name: string; ticket_type?: string; priority?: string; description?: string }) =>
  apiFetch<TicketTemplate>('/templates', { method: 'POST', body: JSON.stringify(body) });

export const updateTemplate = (id: string, body: { name?: string; ticket_type?: string; priority?: string; description?: string; active?: boolean }) =>
  apiFetch<TicketTemplate>(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) });

export const deleteTemplate = (id: string) => apiFetch<void>(`/templates/${id}`, { method: 'DELETE' });

export const changePassword = (body: { current_password: string; new_password: string }) =>
  apiFetch<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const logout = () =>
  apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }).catch(() => ({ ok: false }));

/**
 * Wave-2a full sign-out: revoke server-side, then AWAIT the local api-* cache
 * purge (retry once, warn on failure) before resolving. Callers navigate
 * after this resolves so no authed bytes survive the transition.
 */
export async function signOut(): Promise<void> {
  await logout().catch(() => {});
  await clearSession();
}

export const me = () => apiFetch<AuthUser>('/auth/me');

/** Theme manager: persist the caller's theme pref (syncs across devices). */
export const setThemePref = (theme: string) =>
  apiFetch<{ ok: boolean; theme: string }>('/auth/theme', {
    method: 'PUT',
    body: JSON.stringify({ theme }),
  });

// ---- dashboard ----
export const getDashboardMetrics = () => apiFetch<DashboardMetrics>('/dashboard/metrics');
export const getVelocity = (range: '7d' | '30d') =>
  apiFetch<VelocityResponse>(`/dashboard/velocity?range=${range}`);
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

export const listAssets = (params?: { search?: string; category?: string; status?: string; location_id?: string; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
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
// Warranty alerts: fetch the full bounded bucket list (≤500/server cap); the
// Warranty view client-paginates each bucket. Pass a generous limit so the
// whole scope arrives in one call.
export const getWarrantyAlerts = (scope?: 'all' | 'expired' | 'expiring') =>
  apiFetch<WarrantyAlert[]>(`/assets/alerts${scope ? `?scope=${scope}&limit=500` : '?limit=500'}`);

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

// ---- invoice-parse asset creation ----
// CRITICAL: must NOT go through `apiFetchRaw`. Two reasons:
//   1. apiFetchRaw forces `application/json` on a body when no Content-Type is set.
//   2. Even setting `Content-Type: undefined` is wrong — `new Headers({...})`
//      coerces that to the STRING "undefined" and keeps the header, so the browser
//      never auto-injects the multipart boundary → backend gets "Invalid boundary
//      for multipart/form-data" (400). A pre-built Headers object suppresses the
//      automatic `multipart/form-data; boundary=…`.
// Fix (mirrors uploadTicketAttachment): bypass apiFetch for the multipart request
// and send a raw fetch with a plain headers object and no Content-Type, letting the
// browser set the boundary itself.

/** POST an invoice PDF; backend OCR/parses it into editable drafts. */
export const parseInvoicePdf = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  if (token) await enforceSessionFreshness();
  const res = await fetch('/api/v1/assets/parse-invoice', {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (res.status === 401) {
    if (token) {
      await clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `parse failed: ${res.status}`);
  }
  return res.json() as Promise<InvoiceParseResult>;
};

/** Bind a staged (parsed) document to the just-created asset. */
export const linkInvoiceDocument = (docId: string, assetId: string) =>
  apiFetch<{ ok: boolean }>(`/assets/parse-invoice/${docId}/link/${assetId}`, {
    method: 'POST',
  });

/** List documents attached to an asset. */
export const listAssetDocuments = (assetId: string) =>
  apiFetch<AssetDocument[]>(`/assets/${assetId}/documents`);

/** Absolute href to download an asset document. */
export const assetDocumentUrl = (assetId: string, docId: string) =>
  `/api/v1/assets/${assetId}/documents/${docId}/download`;


/** Export the filtered asset registry as assets.csv — pass ids to export a selection. */
export const exportAssetsCsv = async (params?: {
  search?: string;
  category?: string;
  status?: string;
  location_id?: string;
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
  overdue?: boolean;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  if (params?.overdue) q.set('overdue', 'true');
  if (params?.search) q.set('search', params.search);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  const res = await apiFetchRaw(`/tickets/export${qs ? `?${qs}` : ''}`);
  downloadBlob(await res.blob(), 'tickets.csv');
};

// ---- tickets ----
export const listTickets = (params?: { status?: string; priority?: string; type?: string; overdue?: boolean; search?: string; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.type) q.set('type', params.type);
  if (params?.overdue) q.set('overdue', 'true');
  if (params?.search) q.set('search', params.search);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return apiFetchCount<Ticket>(`/tickets${qs ? `?${qs}` : ''}`);
};
export const getTicket = (ticketId: string) => apiFetch<Ticket>(`/tickets/${ticketId}`);
export const createTicket = (input: CreateTicketInput) => {
  const payload = {
    ...input,
    description: input.description ?? '',
    requester_id: input.requester_id?.trim() || undefined,
    assignee_id: input.assignee_id?.trim() || undefined,
    asset_id: input.asset_id?.trim() || undefined,
  };
  return apiFetch<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(payload) });
};
export const updateTicket = (ticketId: string, input: UpdateTicketInput) =>
  apiFetch<Ticket>(`/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify(input) });
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
  limit?: number;
  offset?: number;
}) => {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiFetchCount<OnboardingEvent>(`/onboarding${qs ? `?${qs}` : ''}`);
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
  limit?: number;
  offset?: number;
}) => {
  const q = new URLSearchParams();
  if (params?.mine) q.set('mine', 'true');
  if (params?.pending) q.set('pending', 'true');
  if (params?.status) q.set('status', params.status);
  if (params?.assignee) q.set('assignee', params.assignee);
  if (params?.search) q.set('search', params.search);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiFetchCount<ServiceRequest>(`/requests${qs ? `?${qs}` : ''}`);
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

export const getLicenses = (params?: { search?: string; scope?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.scope) q.set('scope', params.scope);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiFetchCount<License>(`/licenses${qs ? `?${qs}` : ''}`);
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
  if (token) await enforceSessionFreshness();
  const res = await fetch(`/api/v1/tickets/${ticketId}/attachments`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (res.status === 401) {
    if (token) {
      await clearSession();
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired — please sign in again');
  }
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
  if (token) await enforceSessionFreshness();
  const res = await fetch(`/api/v1/attachments/${attachmentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (res.status === 401) {
    if (token) {
      await clearSession();
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired — please sign in again');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, err?.error || `download failed: ${res.status}`);
  }
  return res.blob();
};

// ── Notifications (P1-2) ────────────────────────────────────────────────────

export const getNotifications = (params?: { limit?: number; offset?: number; unread?: boolean }) => {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  if (params?.unread) q.set('unread', 'true');
  const qs = q.toString();
  return apiFetchCount<Notification>(`/notifications${qs ? `?${qs}` : ''}`);
};

export const getUnreadCount = () =>
  apiFetch<{ unread: number }>('/notifications/unread-count');

export const markNotificationRead = (id: string) =>
  apiFetch<void>(`/notifications/${id}/read`, { method: 'GET' });

export const markAllNotificationsRead = () =>
  apiFetch<void>('/notifications/read-all', { method: 'GET' });

export const getSlaPolicy = () => apiFetch<SlaPolicy>('/sla/policy');

export const listOverdueTickets = (limit = 10) => apiFetchCount<Ticket>(`/tickets?overdue=true&limit=${limit}`);

// ── Phase 2: vendors + claims (#39) ─────────────────────────────────────────
export const listVendors = () => apiFetch<Vendor[]>('/vendors');
export const createVendor = (input: VendorInput) =>
  apiFetch<Vendor>('/vendors', { method: 'POST', body: JSON.stringify(input) });
export const updateVendor = (id: string, input: VendorInput) =>
  apiFetch<Vendor>(`/vendors/${id}`, { method: 'PUT', body: JSON.stringify(input) });
export const deleteVendor = (id: string) => apiFetch<void>(`/vendors/${id}`, { method: 'DELETE' });

export const listClaims = (params?: { vendor_id?: string; asset_id?: string; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.vendor_id) q.set('vendor_id', params.vendor_id);
  if (params?.asset_id) q.set('asset_id', params.asset_id);
  if (params?.limit) q.set('limit', String(params.limit));
  return apiFetch<VendorClaim[]>(`/claims${q.toString() ? `?${q}` : ''}`);
};
export const createClaim = (input: ClaimInput) =>
  apiFetch<VendorClaim>('/claims', { method: 'POST', body: JSON.stringify(input) });
export const deleteClaim = (id: string) => apiFetch<void>(`/claims/${id}`, { method: 'DELETE' });

// ── Phase 2: reports (#49) ──────────────────────────────────────────────────
export const getRepeatIncidents = (params?: { days?: number; min_count?: number; ticket_type?: string }) => {
  const q = new URLSearchParams();
  if (params?.days) q.set('days', String(params.days));
  if (params?.min_count) q.set('min_count', String(params.min_count));
  if (params?.ticket_type) q.set('ticket_type', params.ticket_type);
  return apiFetch<RepeatIncident[]>(`/reports/repeat-incidents${q.toString() ? `?${q}` : ''}`);
};

// ── Phase 2 (#65): QR scan audit ────────────────────────────────────────────
export const scanAudit = (id: string) =>
  apiFetch<QrScanResult>(`/assets/${id}/scan-audit`, { method: 'POST' });


// ── Phase 2 (#40 multi-location) ────────────────────────────────────────────
export const listLocations = (search?: string) => {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<LocationWithCount[]>(`/locations${q}`);
};
export const createLocation = (input: LocationInput) =>
  apiFetch<Location>('/locations', { method: 'POST', body: JSON.stringify(input) });
export const updateLocation = (id: string, input: LocationInput) =>
  apiFetch<Location>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(input) });
export const deleteLocation = (id: string) =>
  apiFetch<void>(`/locations/${id}`, { method: 'DELETE' });
export const listLocationAssets = (id: string) => apiFetch<Asset[]>(`/locations/${id}/assets`);
export const listAssetMoves = (assetId: string) => apiFetch<AssetMove[]>(`/assets/${assetId}/moves`);


// ── #53 Google SSO ──────────────────────────────────────────────────────────
export const getOAuthStatus = () => apiFetch<OAuthStatus>('/auth/oauth/status');
/** Wave-2a: redeem the callback's one-time code for a session (single-use, 5-min TTL). */
export const exchangeOAuthCode = (code: string) =>
  apiFetch<LoginResponse>('/auth/oauth/exchange', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
export const getOAuthAdmin = () => apiFetch<OAuthConfig>('/admin/oauth');
export const updateOAuthAdmin = (input: OAuthConfigUpdate) =>
  apiFetch<OAuthConfig>('/admin/oauth', { method: 'PUT', body: JSON.stringify(input) });
