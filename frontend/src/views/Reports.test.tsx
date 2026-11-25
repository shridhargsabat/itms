// views/Reports.test.tsx — Task 18 fix round 1: CSV export anchor must be
// attached to the document at click time (Firefox ignores clicks on
// detached anchors). jsdom performs no download; we assert attachment +
// href/download attributes instead.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Reports from './Reports';
import { getRepeatIncidents } from '@/api/client';
import type { RepeatIncident } from '@/api/types';

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getRepeatIncidents: vi.fn(),
  };
});

const mockGetRepeatIncidents = vi.mocked(getRepeatIncidents);

const FINDINGS: RepeatIncident[] = [
  {
    title: 'Printer jam',
    ticketType: 'INCIDENT',
    count: 3,
    lastAt: '2026-11-20T10:00:00Z',
    assetTag: 'PRN-01',
    assetId: 'asset-1',
    ticketNumbers: ['T-1', 'T-2', 'T-3'],
  },
];

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const renderReports = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Reports />
    </QueryClientProvider>,
  );

describe('reports csv export (task 18 fix)', () => {
  it('attaches the download anchor to the document before clicking it', async () => {
    mockGetRepeatIncidents.mockResolvedValueOnce(FINDINGS);
    // jsdom has no URL.createObjectURL — stub it; the blob URL itself is opaque.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });

    let clickedAnchor: HTMLAnchorElement | null = null;
    let attachedAtClick = false;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedAnchor = this;
        attachedAtClick = document.body.contains(this);
      });

    renderReports();
    // Wait for the mocked findings to render (button starts disabled).
    await screen.findByText('Printer jam');
    const exportBtn = await screen.findByRole('button', { name: /export csv/i });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(attachedAtClick).toBe(true);
    expect(clickedAnchor!.getAttribute('href')).toBe('blob:fake-url');
    expect(clickedAnchor!.getAttribute('download')).toBe('repeat-incidents-90d.csv');
    // Anchor is cleaned up after the click (no DOM litter across exports).
    expect(document.body.contains(clickedAnchor!)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('attempts no download when there are no findings', async () => {
    mockGetRepeatIncidents.mockResolvedValueOnce([]);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    renderReports();
    const exportBtn = await screen.findByRole('button', { name: /export csv/i });
    expect(exportBtn).toBeDisabled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
