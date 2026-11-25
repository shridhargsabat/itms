import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import Account from './Account';
import Assets from './Assets';
import KnowledgeBase from './KnowledgeBase';
import Licenses from './Licenses';
import Masters from './Masters';
import Onboarding from './Onboarding';
import PasswordFlow from './PasswordFlow';
import Requests from './Requests';
import AssetSpecModal from '@/components/AssetSpecModal';
import InvoiceAssetUpload from '@/components/InvoiceAssetUpload';
import NewTicketForm from '@/components/NewTicketForm';
import * as api from '@/api/client';
import type {
  Asset,
  CatalogItem,
  InvoiceParseResult,
  License,
  LocationWithCount,
  LookupOption,
  MastersMap,
  OnboardingEvent,
  TicketTemplate,
  UserRecord,
} from '@/api/types';

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
    listAssets: vi.fn(),
    listLocations: vi.fn(),
    listUsers: vi.fn(),
    listVendors: vi.fn(),
    getAssetLifecycle: vi.fn(),
    listClaims: vi.fn(),
    listAssetMoves: vi.fn(),
    listAssetDocuments: vi.fn(),
    parseInvoicePdf: vi.fn(),
    listTemplates: vi.fn(),
    listKbArticles: vi.fn(),
    listCanned: vi.fn(),
    getRequests: vi.fn(),
    getCatalog: vi.fn(),
    getMasters: vi.fn(),
    getOnboardingEvents: vi.fn(),
    getOnboardingDetail: vi.fn(),
    getLicenses: vi.fn(),
    getLicenseAlerts: vi.fn(),
  };
});

const ADMIN_USER = { id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' };

const USER: UserRecord = {
  id: 'u-1',
  name: 'Aarav Gupta',
  email: 'aarav@itms.local',
  role: 'EMPLOYEE',
  department: 'IT',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const ASSET: Asset = {
  id: 'a-1',
  asset_tag: 'AST-10014',
  name: 'Lenovo IdeaPad',
  category: 'LAPTOP',
  serial_number: 'SN-1',
  status: 'IN_STOCK',
  assigned_to_user_id: null,
  assigned_user_name: null,
  specs: {},
  purchase_date: null,
  warranty_expiry: null,
  unit_cost: null,
  expected_eol: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const DEPT: LookupOption = {
  id: 'd-1',
  family: 'department',
  code: 'IT',
  label: 'IT',
  sort_order: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const MASTERS: MastersMap = {
  department: [DEPT],
  asset_category: [],
  ticket_type: [],
  ticket_priority: [],
  ticket_status: [],
};

const LAPTOP: CatalogItem = {
  id: 'c-laptop',
  code: 'NEW_LAPTOP',
  name: 'New Laptop Request',
  description: 'Request a new laptop for onboarding or replacement.',
  category: 'Hardware',
  approval_required: true,
  form_fields: [
    { key: 'employee_name', label: 'Employee name', type: 'text', required: true },
    { key: 'department', label: 'Department', type: 'text', required: true },
  ],
  active: true,
  sort_order: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ACCESS: CatalogItem = {
  id: 'c-access',
  code: 'SYSTEM_ACCESS',
  name: 'Access to System X',
  description: 'Request access to a shared system, folder or drive.',
  category: 'Accounts',
  approval_required: false,
  form_fields: [{ key: 'system_name', label: 'System', type: 'text', required: true }],
  active: true,
  sort_order: 40,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

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

function license(partial: Partial<License> & { id: string; name: string }): License {
  return {
    vendor: 'Acme',
    license_type: 'SUBSCRIPTION',
    seats_total: 10,
    seats_used: 6,
    cost_per_seat: 1000,
    cost_total: null,
    currency: 'INR',
    expiry_date: null,
    renewal_cost: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const LIC = license({ id: 'a', name: 'Alpha Suite' });

const LOC: LocationWithCount = {
  id: 'l-1',
  site: 'Main Plant',
  building: 'Factory A',
  floor: 'Floor 2',
  room: 'Server Room',
  created_at: '2026-01-01T00:00:00Z',
  asset_count: 3,
};

const PARSE_RESULT: InvoiceParseResult = {
  drafts: [{ name: 'Dell XPS 15', serialNumber: 'SN-9', category: 'LAPTOP', confidence: { name: 0.9 } }],
  source: 'digital',
  rawPreview: 'INVOICE #123',
  documentId: 'doc-1',
};

beforeEach(() => {
  localStorage.setItem('itms_user', JSON.stringify(ADMIN_USER));
  vi.mocked(api.listAssets).mockResolvedValue({ items: [ASSET], total: 1 });
  vi.mocked(api.listLocations).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({ items: [USER], total: 1 });
  vi.mocked(api.listVendors).mockResolvedValue([]);
  vi.mocked(api.getAssetLifecycle).mockResolvedValue([]);
  vi.mocked(api.listClaims).mockResolvedValue([]);
  vi.mocked(api.listAssetMoves).mockResolvedValue([]);
  vi.mocked(api.listAssetDocuments).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.listKbArticles).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.getRequests).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getCatalog).mockResolvedValue([LAPTOP, ACCESS]);
  vi.mocked(api.getMasters).mockResolvedValue(MASTERS);
  vi.mocked(api.getOnboardingEvents).mockResolvedValue({ items: [EV], total: 1 });
  vi.mocked(api.getOnboardingDetail).mockResolvedValue({ event: EV, tasks: [] });
  vi.mocked(api.getLicenses).mockResolvedValue({ items: [LIC], total: 1 });
  vi.mocked(api.getLicenseAlerts).mockResolvedValue({ expired: [], expiring_30: [], expiring_60: [], expiring_90: [] });
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderInApp(path: string, ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Nearest footer ancestor of a Cancel button; throws when alignment is missing. */
function footerOf(cancel: HTMLElement): HTMLElement {
  const footer = cancel.closest('div.justify-end');
  if (!footer) throw new Error('Cancel button has no justify-end footer ancestor');
  return footer as HTMLElement;
}

/** FORM-03 contract: Cancel exists (caller), footer is right-aligned, Cancel is first. */
function expectCancelFirstFooter(cancel: HTMLElement) {
  const footer = footerOf(cancel);
  expect(footer).toHaveClass('justify-end');
  const buttons = within(footer).getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(1);
  expect(buttons[0]).toBe(cancel);
  return footer;
}

describe('FORM-03 footer alignment + Cancel presence (issue 50)', () => {
  it('Import CSV modal footer is right-aligned with Cancel first', async () => {
    renderInApp('/assets', <Assets />);
    fireEvent.click(await screen.findByRole('button', { name: /^Import$/ }));
    await screen.findByText('Import assets (CSV)');

    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const footer = expectCancelFirstFooter(cancel);
    expect(within(footer).getByRole('button', { name: /import csv/i })).toBeInTheDocument();
  });

  it('InvoiceAssetUpload drafts footer is right-aligned with Cancel first', async () => {
    vi.mocked(api.parseInvoicePdf).mockResolvedValue(PARSE_RESULT);
    const { container } = renderInApp('/assets', <InvoiceAssetUpload onDone={() => {}} onSwitchManual={() => {}} />);

    const file = new File(['%PDF-1.4 fake'], 'invoice.pdf', { type: 'application/pdf' });
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error('missing hidden file input');
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('Line item 1');
    expect(vi.mocked(api.parseInvoicePdf).mock.calls[0][0]).toBe(file);
    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const footer = expectCancelFirstFooter(cancel);
    expect(within(footer).getByRole('button', { name: /add this asset/i })).toBeInTheDocument();
  });

  it('AssetSpecModal editing footer is right-aligned with Cancel first', async () => {
    renderInApp('/assets', <AssetSpecModal asset={ASSET} onClose={() => {}} />);
    await screen.findByText('AST-10014');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const cancel = await screen.findByRole('button', { name: /^Cancel$/i });
    const footer = expectCancelFirstFooter(cancel);
    expect(within(footer).getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('KB article footer is right-aligned with Cancel first', async () => {
    renderInApp('/kb', <KnowledgeBase />);
    const newButtons = await screen.findAllByRole('button', { name: /^new article$/i });
    fireEvent.click(newButtons[0]);
    await screen.findByRole('button', { name: /^create article$/i });

    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const footer = expectCancelFirstFooter(cancel);
    expect(within(footer).getByRole('button', { name: /^create article$/i })).toBeInTheDocument();
  });

  it('KB canned-response footer is right-aligned with Cancel first', async () => {
    renderInApp('/kb', <KnowledgeBase />);
    fireEvent.click(await screen.findByRole('button', { name: /canned responses for agents/i }));
    const newButtons = await screen.findAllByRole('button', { name: /^new canned response$/i });
    fireEvent.click(newButtons[0]);
    await screen.findByRole('button', { name: /^save$/i });

    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const footer = expectCancelFirstFooter(cancel);
    expect(within(footer).getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('Requests create-modal footer is right-aligned with Cancel first', async () => {
    renderInApp('/requests', <Requests />);
    fireEvent.click(await screen.findByRole('button', { name: /new request/i }));
    await screen.findByText('Choose a request type…');

    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    expectCancelFirstFooter(cancel);
  });
});

describe('FORM-06 onboarding wrapping checklist + required name/email (issue 53)', () => {
  it('checklist rows are wrapping grids with truncation guards; name/email show * and aria-required', async () => {
    renderInApp('/onboarding', <Onboarding />);
    await screen.findByTestId('onboarding-card');
    fireEvent.click(screen.getByRole('button', { name: /new joiner event/i }));
    await screen.findByText(/full name/i);

    for (const id of ['onboard-name', 'onboard-email']) {
      const input = document.getElementById(id);
      if (!input) throw new Error(`missing input #${id}`);
      expect(input).toHaveAttribute('aria-required', 'true');
      const label = input.closest('label');
      if (!label) throw new Error(`#${id} has no label ancestor`);
      const star = label.querySelector('[aria-hidden="true"]');
      expect(star).not.toBeNull();
      expect(star).toHaveTextContent('*');
    }

    const titles = screen.getAllByPlaceholderText('Task title');
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title).toHaveClass('min-w-0');
      const row = title.parentElement;
      if (!row) throw new Error('task title input has no row parent');
      expect(row).toHaveClass('grid');
      expect(row).toHaveClass('grid-cols-[minmax(0,1fr)_auto_auto]');
      expect(row.className).not.toMatch(/min-w-\[/);
    }
  });
});

describe('FORM-10 TemplatePicker loading skeleton (issue 57)', () => {
  it('renders a reserved-height skeleton with aria-busy and a disabled Loading-templates select', async () => {
    vi.mocked(api.listTemplates).mockImplementation(() => new Promise<TicketTemplate[]>(() => {}));
    renderInApp('/tickets', <NewTicketForm onDone={() => {}} />);

    const loadingText = await screen.findByText('Loading templates…');
    const skeleton = loadingText.closest('[aria-busy="true"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass('min-h-[68px]');

    const disabledWrap = loadingText.closest('[aria-disabled="true"]');
    expect(disabledWrap).not.toBeNull();
    expect(disabledWrap).toHaveClass('pointer-events-none');
    expect(disabledWrap).toHaveClass('opacity-60');

    const trigger = screen.getByRole('button', { name: /loading templates/i });
    expect(disabledWrap).toContainElement(trigger);
  });
});

describe('FORM-12 muted placeholders, currency options, cost/password copy (issue 59)', () => {
  it('license costs use muted placeholders and the Currency select offers all 8 options', async () => {
    renderInApp('/licenses', <Licenses />);
    await screen.findByTestId('license-card');
    fireEvent.click(screen.getByRole('button', { name: /register license/i }));
    await screen.findByText('Software name *');

    const perSeat = screen.getByPlaceholderText('e.g. 6,120');
    const total = screen.getByPlaceholderText('e.g. 153,000');
    expect(perSeat).toHaveClass('placeholder:text-muted/60');
    expect(total).toHaveClass('placeholder:text-muted/60');

    const curLabel = screen.getByText('Currency').parentElement;
    if (!curLabel) throw new Error('Currency label has no parent');
    fireEvent.click(within(curLabel).getByRole('button'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'SGD', 'AED']);
  });

  it('user password placeholder differs between create and edit', async () => {
    renderInApp('/masters', <Masters />);
    await screen.findByText('Aarav Gupta');

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    const createPw = await screen.findByPlaceholderText('At least 8 characters');
    expect(createPw).toHaveAttribute('id', 'user-password');

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Aarav Gupta' }));
    const editPw = await screen.findByPlaceholderText('Leave blank to keep current password');
    expect(editPw).toHaveAttribute('id', 'user-password');
  });
});

describe('FORM-13 per-family placeholders + Locations pencil edit (issue 60)', () => {
  it('lookup add-row shows the per-family label placeholder', async () => {
    renderInApp('/masters', <Masters />);
    await screen.findByText('Aarav Gupta');

    const pairs: Array<[string, string]> = [
      ['Departments', 'e.g. Finance'],
      ['Asset Categories', 'e.g. Monitor'],
      ['Ticket Types', 'e.g. Access Request'],
      ['Priorities', 'e.g. Blocker'],
      ['Statuses', 'e.g. Pending Vendor'],
    ];
    for (const [tab, placeholder] of pairs) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(await screen.findByPlaceholderText(placeholder)).toBeInTheDocument();
    }
  });

  it('Locations rows have a pencil edit button with aria-label under the Actions header', async () => {
    vi.mocked(api.listLocations).mockResolvedValue([LOC]);
    renderInApp('/masters', <Masters />);
    await screen.findByText('Aarav Gupta');
    fireEvent.click(screen.getByRole('tab', { name: 'Locations' }));

    await screen.findByText('Main Plant / Factory A / Floor 2 / Server Room');
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit Main Plant / Factory A / Floor 2 / Server Room' });
    expect(edit.querySelector('svg')).not.toBeNull();
  });
});

describe('FORM-14 account affordances + PasswordFlow shell (issue 61)', () => {
  it('Account shows the profile header, hints, and working show/hide toggles', async () => {
    localStorage.setItem(
      'itms_user',
      JSON.stringify({ id: 'u-1', email: 'emp@itms.local', name: 'Emp', role: 'EMPLOYEE', department: 'IT' }),
    );
    renderInApp('/account', <Account />);

    expect(await screen.findByText('Emp')).toBeInTheDocument();
    expect(screen.getByText('emp@itms.local')).toBeInTheDocument();
    expect(screen.getByText('EMPLOYEE')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();

    const cases: Array<[string, string, string]> = [
      ['Show current password', 'Hide current password', 'account-current'],
      ['Show new password', 'Hide new password', 'account-new'],
      ['Show confirmed password', 'Hide confirmed password', 'account-confirm'],
    ];
    for (const [show, hide, id] of cases) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (!input) throw new Error(`missing input #${id}`);
      expect(input.type).toBe('password');
      fireEvent.click(screen.getByRole('button', { name: show }));
      expect(screen.getByRole('button', { name: hide })).toBeInTheDocument();
      expect(input.type).toBe('text');
      fireEvent.click(screen.getByRole('button', { name: hide }));
      expect(input.type).toBe('password');
    }
  });

  it('PasswordFlow renders both flows inside the centered AuthShell', async () => {
    renderInApp('/forgot-password', <PasswordFlow />);
    const forgotHeading = await screen.findByText('Reset your password');
    const forgotShell = forgotHeading.closest('.min-h-dvh');
    expect(forgotShell).not.toBeNull();
    expect(forgotShell).toHaveClass('bg-base');
    expect(forgotShell).toHaveClass('items-center');
    expect(forgotShell).toHaveClass('justify-center');
    const forgotInner = (forgotShell as HTMLElement).querySelector('.max-w-md');
    expect(forgotInner).not.toBeNull();
    expect(forgotInner).toContainElement(forgotHeading);

    cleanup();
    renderInApp('/reset-password?token=tok123', <PasswordFlow />);
    const resetHeading = await screen.findByText('Set a new password');
    const resetShell = resetHeading.closest('.min-h-dvh');
    expect(resetShell).not.toBeNull();
    expect(resetShell).toHaveClass('bg-base');
    expect(resetShell).toHaveClass('items-center');
    expect(resetShell).toHaveClass('justify-center');
  });
});
