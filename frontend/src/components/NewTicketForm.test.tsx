import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewTicketForm from './NewTicketForm';
import { createTicket, listAssets, listTemplates, listUsers, suggestArticles } from '@/api/client';
import type { TicketTemplate, UserRecord } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    createTicket: vi.fn(),
    listAssets: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    suggestArticles: vi.fn(),
  };
});

// jsdom lacks Element.scrollIntoView (Select.toggle calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setUser(role: string, id = 'u-self') {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id, email: 't@itms.local', name: 'T User', role, department: 'IT' }),
  );
}

function user(over: Partial<UserRecord> & Pick<UserRecord, 'id' | 'name'>): UserRecord {
  return {
    email: `${over.id}@itms.local`,
    role: 'EMPLOYEE',
    department: 'IT',
    active: true,
    created_at: '2026-11-20T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listTemplates).mockResolvedValue([]);
  vi.mocked(suggestArticles).mockResolvedValue([]);
});

function renderForm() {
  render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <NewTicketForm onDone={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewTicketForm requester picker offers only active users (CT-03, issue 157)', () => {
  it('excludes inactive users the backend would 422', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({
      items: [user({ id: 'u-active', name: 'Active Ana' }), user({ id: 'u-inactive', name: 'Inactive Ian', active: false })],
      total: 2,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /Active Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Inactive Ian/ })).not.toBeInTheDocument();
  });

  it('hides the (You) fallback when the page knows self as inactive', async () => {
    setUser('ADMIN', 'u-self');
    vi.mocked(listUsers).mockResolvedValue({
      items: [
        user({ id: 'u-self', name: 'T User', active: false }),
        user({ id: 'u-active', name: 'Active Ana' }),
      ],
      total: 2,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /Active Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\(You\)/ })).not.toBeInTheDocument();
  });

  it('keeps the (You) fallback when self is missing from the page', async () => {
    setUser('ADMIN', 'u-self');
    vi.mocked(listUsers).mockResolvedValue({
      items: [user({ id: 'u-active', name: 'Active Ana' })],
      total: 1,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /T User \(You\)/ })).toBeInTheDocument();
  });
});

describe('NewTicketForm label associations (UX-02, issue 176)', () => {
  it('associates the Title label with its input via id/htmlFor', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    const title = await screen.findByLabelText(/title/i);
    expect(title).toHaveAttribute('id', 'new-ticket-title');
    expect(title).toHaveAttribute('placeholder', "What's the issue?");
  });

  it('associates the Description label with its textarea via id/htmlFor', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    const desc = await screen.findByLabelText(/description/i);
    expect(desc.tagName).toBe('TEXTAREA');
    expect(desc).toHaveAttribute('id', 'new-ticket-description');
  });

  it('passes ids to the Type/Priority/Requester/Asset pickers matching their labels', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    await screen.findByRole('button', { name: 'Create Ticket' });
    const pairs = [
      ['Type', 'new-ticket-type'],
      ['Priority', 'new-ticket-priority'],
      ['Requester', 'new-ticket-requester'],
      ['Linked Asset', 'new-ticket-asset'],
    ] as const;
    for (const [text, id] of pairs) {
      const label = screen.getByText(text);
      expect(label.tagName).toBe('LABEL');
      expect(label).toHaveAttribute('for', id);
      // The Select trigger carries the id the label points at.
      expect(document.getElementById(id)?.tagName).toBe('BUTTON');
    }
  });

  it('associates the template picker label via id passthrough', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    const tpl: TicketTemplate = {
      id: 'tpl-1',
      name: 'VPN fix',
      ticket_type: 'INCIDENT',
      priority: 'HIGH',
      description: 'Template-provided steps',
      active: true,
      created_by: null,
      updated_by: null,
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z',
    };
    vi.mocked(listTemplates).mockResolvedValue([tpl]);
    renderForm();

    const trigger = await screen.findByRole('button', { name: 'Choose a template' });
    expect(trigger).toHaveAttribute('id', 'new-ticket-template');
    expect(screen.getByText('Start from a template')).toHaveAttribute('for', 'new-ticket-template');
  });
});

describe('NewTicketForm title validation (UX-03, issue 177)', () => {
  it('disables native validation (noValidate) so errors surface through the FieldError live region', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    const submit = await screen.findByRole('button', { name: 'Create Ticket' });
    expect(submit.closest('form')).toHaveAttribute('novalidate');
  });

  it('validates the trimmed title on blur with the same announced error as submit', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    const title = (await screen.findByLabelText(/title/i)) as HTMLInputElement;
    // Empty blur → announced alert wired via errProps.
    fireEvent.blur(title);
    const emptyAlert = await screen.findByRole('alert');
    expect(emptyAlert).toHaveTextContent('Title is required.');
    expect(emptyAlert).toHaveAttribute('id', 'new-ticket-title-error');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-describedby', 'new-ticket-title-error');
    const emptyHtml = emptyAlert.outerHTML;
    // Fix, then whitespace-only blur → identical styled announced error.
    fireEvent.change(title, { target: { value: 'A real title' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    const wsAlert = await screen.findByRole('alert');
    expect(wsAlert.outerHTML).toBe(emptyHtml);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('submit with an empty title focuses the title field (focus-first-invalid)', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Create Ticket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Title is required.');
    expect(document.activeElement).toBe(await screen.findByLabelText(/title/i));
    expect(createTicket).not.toHaveBeenCalled();
  });
});

describe('NewTicketForm searchable pickers (UX-04 core, issue 178)', () => {
  it('enables the searchable filter on the requester and asset pickers only', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [user({ id: 'u-1', name: 'Ana' })], total: 1 });
    renderForm();

    // Requester: searchable.
    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));
    expect(await screen.findByRole('textbox', { name: 'Filter options' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter options' }), { key: 'Escape' });
    // Asset: searchable.
    fireEvent.click(await screen.findByRole('button', { name: 'Linked Asset' }));
    expect(await screen.findByRole('textbox', { name: 'Filter options' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter options' }), { key: 'Escape' });
    // Type: short list stays non-searchable.
    fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Filter options' })).not.toBeInTheDocument();
  });

  it('keeps the Showing-X-of-Y truncation notice under the pickers', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({ items: [user({ id: 'u-1', name: 'Ana' })], total: 42 });
    renderForm();

    expect(await screen.findByText('Showing first 1 of 42 users')).toBeInTheDocument();
  });
});
