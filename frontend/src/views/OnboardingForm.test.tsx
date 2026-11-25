import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Onboarding from './Onboarding';
import * as api from '@/api/client';
import type { OnboardingEvent } from '@/api/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getOnboardingEvents: vi.fn(),
    getOnboardingDetail: vi.fn(),
    createOnboardingEvent: vi.fn(),
    updateOnboardingEvent: vi.fn(),
  };
});

const EV: OnboardingEvent = {
  id: 'ev-1',
  event_type: 'ONBOARDING',
  person_name: 'Priya Sharma',
  person_email: 'priya@example.com',
  start_date: '2026-08-21',
  notes: null,
  status: 'OPEN',
  created_by: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  total_tasks: 4,
  done_tasks: 1,
  overdue_tasks: 0,
};

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.getOnboardingEvents).mockResolvedValue({ items: [EV], total: 1 });
  vi.mocked(api.getOnboardingDetail).mockResolvedValue({ event: EV, tasks: [] });
});

function renderOnboarding() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Onboarding />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openCreateModal() {
  renderOnboarding();
  await screen.findByTestId('onboarding-card');
  fireEvent.click(screen.getByRole('button', { name: /new joiner event/i }));
  await screen.findByText(/full name/i);
}

describe('Onboarding submit validation (FORM-02)', () => {
  it('empty create submit shows inline errors, blocks createOnboardingEvent, and focuses name', async () => {
    await openCreateModal();
    fireEvent.click(screen.getByRole('button', { name: /^create event$/i }));

    expect(await screen.findByText('Full name is required')).toHaveRole('alert');
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(api.createOnboardingEvent).not.toHaveBeenCalled();
    expect(document.getElementById('onboard-name')).toHaveFocus();
  });

  it('invalid email shows a format error and focuses email', async () => {
    await openCreateModal();
    fireEvent.change(document.getElementById('onboard-name')!, { target: { value: 'Priya Sharma' } });
    fireEvent.change(document.getElementById('onboard-email')!, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /^create event$/i }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(api.createOnboardingEvent).not.toHaveBeenCalled();
    expect(document.getElementById('onboard-email')).toHaveFocus();
  });

  it('valid create submit sends the payload via createOnboardingEvent', async () => {
    vi.mocked(api.createOnboardingEvent).mockResolvedValue(EV);
    await openCreateModal();
    fireEvent.change(document.getElementById('onboard-name')!, { target: { value: 'Priya Sharma' } });
    fireEvent.change(document.getElementById('onboard-email')!, { target: { value: 'priya@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^create event$/i }));

    await waitFor(() => expect(api.createOnboardingEvent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createOnboardingEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        event_type: 'ONBOARDING',
        person_name: 'Priya Sharma',
        person_email: 'priya@example.com',
      }),
    );
  });

  it('edit submit with a cleared name shows an inline error and blocks updateOnboardingEvent', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-card'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^edit$/i }));
    await screen.findByText('Edit event');

    fireEvent.change(document.getElementById('edit-event-name')!, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Full name is required')).toBeInTheDocument();
    expect(api.updateOnboardingEvent).not.toHaveBeenCalled();
    expect(document.getElementById('edit-event-name')).toHaveFocus();
  });
});
