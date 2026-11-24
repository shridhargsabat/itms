import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ABSOLUTE_SESSION_MS,
  clearSession,
  evaluateSessionFreshness,
  getToken,
  IDLE_TIMEOUT_MS,
  setSession,
} from '@/api/client';

describe('wave-2a session lifetime', () => {
  it('pins the idle timeout at 30 min and the absolute cap at 12 h', () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(ABSOLUTE_SESSION_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('fresh session is ok', () => {
    const now = 1_700_000_000_000;
    expect(evaluateSessionFreshness(now - 1000, now - 1000, now)).toBe('ok');
  });

  it('trips idle only past the 30-min boundary', () => {
    const now = 1_700_000_000_000;
    expect(evaluateSessionFreshness(now - 1000, now - IDLE_TIMEOUT_MS, now)).toBe('ok');
    expect(evaluateSessionFreshness(now - 1000, now - IDLE_TIMEOUT_MS - 1, now)).toBe('idle');
  });

  it('trips absolute past the 12-h cap even with recent activity', () => {
    const now = 1_700_000_000_000;
    expect(evaluateSessionFreshness(now - ABSOLUTE_SESSION_MS, now, now)).toBe('ok');
    expect(evaluateSessionFreshness(now - ABSOLUTE_SESSION_MS - 1, now, now)).toBe('absolute');
  });

  it('gives grace to missing stamps (pre-wave-2a sessions)', () => {
    const now = 1_700_000_000_000;
    expect(evaluateSessionFreshness(null, now, now)).toBe('ok');
    expect(evaluateSessionFreshness(now, null, now)).toBe('ok');
    expect(evaluateSessionFreshness(null, null, now)).toBe('ok');
  });
});

describe('wave-2a clearSession purge', () => {
  const realCaches = Object.getOwnPropertyDescriptor(window, 'caches');

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Remove any test-installed mock, restoring the original (usually absent in jsdom).
    if (realCaches) {
      Object.defineProperty(window, 'caches', realCaches);
    } else {
      // @ts-expect-error jsdom has no caches — delete the mock
      delete window.caches;
    }
    localStorage.clear();
  });

  function installCachesMock(mock: { keys: () => Promise<string[]>; delete: (k: string) => Promise<boolean> }) {
    Object.defineProperty(window, 'caches', { value: mock, configurable: true, writable: true });
  }

  it('clears storage synchronously and purges only api-* caches', async () => {
    setSession('tok', { id: '1', email: 'a@b.c', name: 'A', role: 'ADMIN', department: 'IT' });
    const deleted: string[] = [];
    installCachesMock({
      keys: async () => ['api-fresh', 'workbox-precache', 'api-catalog'],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      },
    });
    const p = clearSession();
    // token gone before any await resolves
    expect(localStorage.getItem('itms_token')).toBeNull();
    await p;
    expect(deleted.sort()).toEqual(['api-catalog', 'api-fresh']);
  });

  it('retries the purge once on transient failure', async () => {
    let calls = 0;
    installCachesMock({
      keys: async () => {
        calls += 1;
        if (calls === 1) throw new Error('stall');
        return ['api-fresh'];
      },
      delete: async () => true,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await clearSession();
    expect(calls).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (never throws) when the purge fails twice', async () => {
    installCachesMock({
      keys: async () => {
        throw new Error('nope');
      },
      delete: async () => true,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(clearSession()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toMatch(/purge failed after retry/);
  });

  it('resolves fine with no CacheStorage (jsdom / private mode)', async () => {
    await expect(clearSession()).resolves.toBeUndefined();
  });
});

describe('wave-2b memory-only Bearer (code-scanning #2)', () => {
  const user = { id: '1', email: 'a@b.c', name: 'A', role: 'ADMIN', department: 'IT' } as const;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('setSession keeps the Bearer token out of localStorage but available in-session', () => {
    setSession('tok', { ...user });
    expect(localStorage.getItem('itms_token')).toBeNull();
    expect(getToken()).toBe('tok');
    // Profile cache stays: offline PWA + sync role gating need it (alert #3 accepted risk).
    expect(JSON.parse(localStorage.getItem('itms_user') ?? 'null')).toMatchObject({ email: 'a@b.c' });
  });

  it('clearSession drops the in-memory token and purges any legacy stored token', async () => {
    setSession('tok', { ...user });
    localStorage.setItem('itms_token', 'legacy');
    await clearSession();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('itms_token')).toBeNull();
  });

  it('purges a legacy localStorage token on module load', async () => {
    localStorage.setItem('itms_token', 'legacy');
    vi.resetModules();
    await import('@/api/client');
    expect(localStorage.getItem('itms_token')).toBeNull();
  });
});
