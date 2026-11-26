import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getTicketTimeline, setSession } from '@/api/client';

const USER = { id: 'u-1', email: 't@itms.local', name: 'T User', role: 'ADMIN', department: 'IT' };

function freshSession(token = 'mem-token') {
  setSession(token, { ...USER });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMPTY_TIMELINE = { comments: [], changes: [], attachments: [] };

describe('CT-07 getTicketTimeline limit/offset passthrough (issue 169)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    await clearSession();
  });

  it('appends explicit limit/offset to the timeline URL', async () => {
    freshSession();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EMPTY_TIMELINE, 200));
    vi.stubGlobal('fetch', fetchMock);

    await getTicketTimeline('t-1', { limit: 100, offset: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tickets/t-1/timeline?limit=100&offset=20');
  });

  it('omits the query string when no paging is passed', async () => {
    freshSession();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EMPTY_TIMELINE, 200));
    vi.stubGlobal('fetch', fetchMock);

    await getTicketTimeline('t-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/tickets/t-1/timeline');
  });
});
