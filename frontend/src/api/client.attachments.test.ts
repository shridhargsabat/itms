import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearSession,
  downloadTicketAttachment,
  getToken,
  setSession,
  uploadTicketAttachment,
} from '@/api/client';

const USER = { id: 'u-1', email: 't@itms.local', name: 'T User', role: 'ADMIN', department: 'IT' };

function freshSession(token = 'mem-token') {
  setSession(token, { ...USER });
}

function staleSession(token = 'mem-token') {
  freshSession(token);
  // Push last-activity past the 30-min idle timeout.
  localStorage.setItem('itms_last_activity', String(Date.now() - 31 * 60 * 1000));
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
  return init.headers;
}

describe('CT-05 ticket attachment auth (issue 158)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    await clearSession();
  });

  it('upload sends the in-memory Bearer, never the purged localStorage token', async () => {
    freshSession('mem-abc');
    localStorage.setItem('itms_token', 'stale-legacy');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'a-1' }, 200));
    vi.stubGlobal('fetch', fetchMock);

    await uploadTicketAttachment('t-1', new File(['x'], 'x.txt', { type: 'text/plain' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders(fetchMock)).toMatchObject({ Authorization: 'Bearer mem-abc' });
  });

  it('upload enforces session freshness first: stale session throws 401 with no fetch', async () => {
    staleSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadTicketAttachment('t-1', new File(['x'], 'x.txt'))).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('upload 401 unconditionally clears the session and throws ApiError 401', async () => {
    freshSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    const err = await uploadTicketAttachment('t-1', new File(['x'], 'x.txt')).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('itms_user')).toBeNull();
  });

  it('upload 401 clears even with no memory token (cookie-only session)', async () => {
    localStorage.setItem('itms_user', JSON.stringify(USER));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    await expect(uploadTicketAttachment('t-1', new File(['x'], 'x.txt'))).rejects.toMatchObject({
      status: 401,
    });
    expect(localStorage.getItem('itms_user')).toBeNull();
  });

  it('upload preserves non-401 failures as ApiError(status, detail)', async () => {
    freshSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'file too large' }, 413)));

    const err = await uploadTicketAttachment('t-1', new File(['x'], 'x.txt')).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
    expect(err.message).toBe('file too large');
  });

  it('upload falls back to a status-bearing message on non-JSON errors', async () => {
    freshSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 500 })));

    const err = await uploadTicketAttachment('t-1', new File(['x'], 'x.txt')).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('upload failed: 500');
  });

  it('download sends the in-memory Bearer, never the purged localStorage token', async () => {
    freshSession('mem-dl');
    localStorage.setItem('itms_token', 'stale-legacy');
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await downloadTicketAttachment('a-1');

    // (No instanceof: undici's Blob lives in a different realm than jsdom's.)
    expect(blob.size).toBe(5);
    expect(await blob.text()).toBe('bytes');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/attachments/a-1/download');
    expect(sentHeaders(fetchMock)).toMatchObject({ Authorization: 'Bearer mem-dl' });
  });

  it('download enforces session freshness first: stale session throws 401 with no fetch', async () => {
    staleSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadTicketAttachment('a-1')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('download 401 unconditionally clears the session and throws ApiError 401', async () => {
    freshSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    const err = await downloadTicketAttachment('a-1').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('itms_user')).toBeNull();
  });

  it('download preserves non-401 failures as ApiError(status, detail)', async () => {
    freshSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'attachment gone' }, 404)));

    const err = await downloadTicketAttachment('a-1').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('attachment gone');
  });
});
