import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNetworkFailure, RequireAuth } from './RequireAuth';
import * as client from '@/api/client';
import { ApiError } from '@/api/client';
import type { AuthUser } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
// Keep the real ApiError (instanceof checks) but stub the session fns + me.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getToken: vi.fn(),
    getCachedUser: vi.fn(),
    clearSession: vi.fn(),
    me: vi.fn(),
  };
});
vi.mock('@/lib/theme', () => ({ hydrateThemeFromUser: vi.fn() }));

const cachedUser: AuthUser = {
  id: 'u1',
  email: 'tech@company.com',
  name: 'Tech',
  role: 'admin',
  department: 'IT',
};

function setup(token: string | null, cached: AuthUser | null, meImpl: () => Promise<AuthUser>) {
  vi.mocked(client.getToken).mockReturnValue(token);
  vi.mocked(client.getCachedUser).mockReturnValue(cached);
  vi.mocked(client.me).mockImplementation(meImpl);
}

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/assets']}>
        <Routes>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route
            path="/assets"
            element={
              <RequireAuth>
                <div>PROTECTED</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RequireAuth matrix (Wave 2-C)', () => {
  it('no token → /login without calling me()', async () => {
    setup(null, null, () => Promise.resolve(cachedUser));
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.me).not.toHaveBeenCalled();
  });

  it('valid session → renders children', async () => {
    setup('tok', cachedUser, () => Promise.resolve(cachedUser));
    renderGate();
    expect(await screen.findByText('PROTECTED')).toBeInTheDocument();
    expect(client.clearSession).not.toHaveBeenCalled();
  });

  it('401 → clears session and bounces to /login', async () => {
    setup('tok', cachedUser, () => Promise.reject(new ApiError(401, 'expired')));
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.clearSession).toHaveBeenCalled();
  });

  it('403 → exactly like 401 (clear + /login, NO cached fallback)', async () => {
    setup('tok', cachedUser, () => Promise.reject(new ApiError(403, 'forbidden')));
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.clearSession).toHaveBeenCalled();
  });

  it('server 500 with cache → /login (server verdicts never fall back)', async () => {
    setup('tok', cachedUser, () => Promise.reject(new ApiError(500, 'boom')));
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.clearSession).toHaveBeenCalled();
  });

  it('offline TypeError with cache → renders children, keeps session', async () => {
    setup('tok', cachedUser, () => Promise.reject(new TypeError('Failed to fetch')));
    renderGate();
    expect(await screen.findByText('PROTECTED')).toBeInTheDocument();
    expect(client.clearSession).not.toHaveBeenCalled();
  });

  it('offline TypeError without cache → /login', async () => {
    setup('tok', null, () => Promise.reject(new TypeError('Failed to fetch')));
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.clearSession).toHaveBeenCalled();
  });

  it('AbortError with cache → renders children, keeps session', async () => {
    setup('tok', cachedUser, () =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
    renderGate();
    expect(await screen.findByText('PROTECTED')).toBeInTheDocument();
    expect(client.clearSession).not.toHaveBeenCalled();
  });

  it('AbortError without cache → /login', async () => {
    setup('tok', null, () =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
    renderGate();
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(client.clearSession).toHaveBeenCalled();
  });
});

describe('isNetworkFailure branch coverage', () => {
  it('true for fetch TypeError', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('true for DOM AbortError', () => {
    expect(isNetworkFailure(new DOMException('aborted', 'AbortError'))).toBe(true);
  });
  it('true for AbortError-shaped objects', () => {
    expect(isNetworkFailure({ name: 'AbortError' })).toBe(true);
  });
  it('false for ApiError 401/403/500', () => {
    expect(isNetworkFailure(new ApiError(401, 'x'))).toBe(false);
    expect(isNetworkFailure(new ApiError(403, 'x'))).toBe(false);
    expect(isNetworkFailure(new ApiError(500, 'x'))).toBe(false);
  });
  it('false for plain Errors and non-objects', () => {
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure('AbortError')).toBe(false);
  });
});

describe('offline signal from fetch (real me(), mocked fetch)', () => {
  it('fetch TypeError propagates as TypeError (offline fallback trigger)', async () => {
    const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await actual.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(isNetworkFailure(err)).toBe(true);
  });

  it('fetch AbortError propagates with name AbortError', async () => {
    const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    );
    const err = await actual.me().catch((e: unknown) => e);
    expect((err as DOMException).name).toBe('AbortError');
    expect(isNetworkFailure(err)).toBe(true);
  });

  it('waits for the settled route (no act warnings)', async () => {
    setup('tok', cachedUser, () => Promise.resolve(cachedUser));
    renderGate();
    await waitFor(() => expect(screen.getByText('PROTECTED')).toBeInTheDocument());
  });
});
