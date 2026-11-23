import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  GitBranch,
  LayoutGrid,
  Monitor,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

// ============================================================================
// TYPES (Aligned with shridhargsabat/itms -> frontend/src/api/types.ts)
// ============================================================================

export type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'MAINTENANCE' | 'RETIRED';
export type AssetCategory =
  | 'LAPTOP'
  | 'DESKTOP'
  | 'SERVER'
  | 'NETWORK_DEVICE'
  | 'MONITOR'
  | 'LICENSE';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketType = 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type GlassMode = 'day' | 'night';

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  serial_number: string;
  status: AssetStatus;
  assigned_user_name: string;
  location_name: string;
  vendor_name: string;
  unit_cost: number;
  current_value: number;
  warranty_expiry: string;
  days_left: number;
}

export interface TicketRecord {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  ticket_type: TicketType;
  priority: Priority;
  status: TicketStatus;
  sla_due_at: string;
  sla_escalated: boolean;
  requester_name: string;
  assignee_name: string;
  asset_tag: string;
  created: string;
}

export interface ImpactedAsset extends Asset {
  depth: number;
}

export interface VelocityPoint {
  day: string;
  incidents: number;
  requests: number;
  resolved: number;
}

// ============================================================================
// DESIGN SYSTEM TOKENS (Apple Liquid Glass — Day & Night)
// ============================================================================

export function getLiquidGlassClasses(isNight: boolean) {
  return {
    canvas: isNight
      ? 'bg-gradient-to-br from-[#0B1226] via-[#131836] to-[#0A192F] text-white'
      : 'bg-gradient-to-br from-[#DCEBFF] via-[#EEF2FF] to-[#FCE7F3] text-slate-900',
    panel: isNight
      ? 'bg-white/[0.09] backdrop-blur-2xl backdrop-saturate-150 border border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_16px_40px_rgba(0,0,0,0.45)]'
      : 'bg-white/50 backdrop-blur-2xl backdrop-saturate-150 border border-white/75 shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.95),0_12px_36px_rgba(15,23,42,0.08)]',
    subCard: isNight
      ? 'bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
      : 'bg-white/60 hover:bg-white/80 border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_14px_rgba(15,23,42,0.04)]',
    pill: isNight
      ? 'bg-white/[0.10] backdrop-blur-xl border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
      : 'bg-white/60 backdrop-blur-xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_6px_20px_rgba(15,23,42,0.06)]',
    textPrimary: isNight ? 'text-white' : 'text-slate-900',
    textSecondary: isNight ? 'text-white/70' : 'text-slate-600',
    textMuted: isNight ? 'text-white/50' : 'text-slate-500',
  };
}

// ============================================================================
// SAMPLE DATA (Replace with TanStack Query hooks in shridhargsabat/itms)
// ============================================================================

const SAMPLE_ASSETS: Asset[] = [
  {
    id: 'ast-1',
    asset_tag: 'SRV-MUM-001',
    name: 'Core PostgreSQL 18 Primary',
    category: 'SERVER',
    serial_number: 'DL380-G11-9041',
    status: 'ASSIGNED',
    assigned_user_name: 'Infra Core',
    location_name: 'Mumbai DC Rack A2',
    vendor_name: 'HPE India',
    unit_cost: 485000,
    current_value: 412000,
    warranty_expiry: '2026-12-14',
    days_left: 21,
  },
  {
    id: 'ast-2',
    asset_tag: 'NET-MUM-004',
    name: 'Cisco Catalyst 9300 Core Switch',
    category: 'NETWORK_DEVICE',
    serial_number: 'FCW2519L09X',
    status: 'ASSIGNED',
    assigned_user_name: 'NetOps Team',
    location_name: 'Mumbai HQ Floor 4',
    vendor_name: 'Cisco Systems',
    unit_cost: 295000,
    current_value: 248000,
    warranty_expiry: '2026-12-08',
    days_left: 15,
  },
  {
    id: 'ast-3',
    asset_tag: 'SRV-CLD-009',
    name: 'ITMS Axum API + Traefik Node',
    category: 'SERVER',
    serial_number: 'AWS-AP-SOUTH-1A',
    status: 'ASSIGNED',
    assigned_user_name: 'DevSecOps',
    location_name: 'AWS ap-south-1',
    vendor_name: 'Amazon Web Services',
    unit_cost: 168000,
    current_value: 168000,
    warranty_expiry: '2027-08-30',
    days_left: 280,
  },
  {
    id: 'ast-4',
    asset_tag: 'LPT-ENG-142',
    name: 'MacBook Pro 16" M3 Max',
    category: 'LAPTOP',
    serial_number: 'C02YM4K9MD6R',
    status: 'ASSIGNED',
    assigned_user_name: 'Aarav Mehta',
    location_name: 'Mumbai HQ',
    vendor_name: 'Apple Enterprise',
    unit_cost: 349000,
    current_value: 295000,
    warranty_expiry: '2027-03-19',
    days_left: 116,
  },
  {
    id: 'ast-5',
    asset_tag: 'LPT-ENG-158',
    name: 'ThinkPad X1 Carbon Gen 12',
    category: 'LAPTOP',
    serial_number: 'PF4K8812',
    status: 'IN_STOCK',
    assigned_user_name: 'Unassigned',
    location_name: 'IT Store · Mumbai',
    vendor_name: 'Lenovo India',
    unit_cost: 172000,
    current_value: 172000,
    warranty_expiry: '2028-01-15',
    days_left: 418,
  },
  {
    id: 'ast-6',
    asset_tag: 'LIC-M365-001',
    name: 'Microsoft 365 E5 (250 Seats)',
    category: 'LICENSE',
    serial_number: 'ENTRA-TENANT-E5',
    status: 'ASSIGNED',
    assigned_user_name: 'IAM & Workplace',
    location_name: 'Cloud Tenant',
    vendor_name: 'Microsoft',
    unit_cost: 920000,
    current_value: 920000,
    warranty_expiry: '2026-12-05',
    days_left: 12,
  },
];

const SAMPLE_TICKETS: TicketRecord[] = [
  {
    id: 'tkt-1',
    ticket_number: 'TKT-1048',
    title: 'PostgreSQL 18 connection pool exhaustion on ITMS API',
    description: 'Spike in concurrent CMDB impact queries saturated sqlx pool limit.',
    ticket_type: 'INCIDENT',
    priority: 'URGENT',
    status: 'OPEN',
    sla_due_at: '22m left',
    sla_escalated: true,
    requester_name: 'Priya Nair',
    assignee_name: 'Aarav Mehta',
    asset_tag: 'SRV-MUM-001',
    created: '18m ago',
  },
  {
    id: 'tkt-2',
    ticket_number: 'TKT-1047',
    title: 'Cisco Catalyst 9300 uplink flapping on Floor 4 IDF',
    description: 'Intermittent 10G SFP+ link drops impacting VoIP and Wi-Fi APs.',
    ticket_type: 'INCIDENT',
    priority: 'URGENT',
    status: 'IN_PROGRESS',
    sla_due_at: 'Overdue 14m',
    sla_escalated: true,
    requester_name: 'Rohan Kulkarni',
    assignee_name: 'Rohan Kulkarni',
    asset_tag: 'NET-MUM-004',
    created: '1h ago',
  },
  {
    id: 'tkt-3',
    ticket_number: 'TKT-1045',
    title: 'New hire MacBook + M365 E5 provisioning (DevSecOps)',
    description: 'Onboarding bundle overdue by 1 day; needs laptop assignment & Entra ID groups.',
    ticket_type: 'SERVICE_REQUEST',
    priority: 'HIGH',
    status: 'OPEN',
    sla_due_at: '2h 10m left',
    sla_escalated: false,
    requester_name: 'HR Onboarding',
    assignee_name: 'Karan Verma',
    asset_tag: 'LPT-ENG-158',
    created: '3h ago',
  },
  {
    id: 'tkt-4',
    ticket_number: 'TKT-1044',
    title: 'Traefik v3.6 TLS certificate renewal & HSTS header change',
    description: 'Scheduled change window for itms.ai-automation-hub.tech ingress.',
    ticket_type: 'CHANGE',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    sla_due_at: '4h 30m left',
    sla_escalated: false,
    requester_name: 'Vikram Joshi',
    assignee_name: 'Vikram Joshi',
    asset_tag: 'SRV-CLD-009',
    created: '4h ago',
  },
];

const CMDB_EDGES = [
  { parent: 'ast-2', child: 'ast-1' },
  { parent: 'ast-2', child: 'ast-3' },
  { parent: 'ast-1', child: 'ast-3' },
  { parent: 'ast-3', child: 'ast-6' },
  { parent: 'ast-6', child: 'ast-4' },
];

const VELOCITY_DATA: Record<'7d' | '30d', VelocityPoint[]> = {
  '7d': [
    { day: 'Mon', incidents: 12, requests: 18, resolved: 27 },
    { day: 'Tue', incidents: 15, requests: 21, resolved: 34 },
    { day: 'Wed', incidents: 9, requests: 16, resolved: 26 },
    { day: 'Thu', incidents: 14, requests: 19, resolved: 31 },
    { day: 'Fri', incidents: 11, requests: 22, resolved: 32 },
    { day: 'Sat', incidents: 4, requests: 6, resolved: 11 },
    { day: 'Sun', incidents: 5, requests: 5, resolved: 10 },
  ],
  '30d': [
    { day: 'Wk 1', incidents: 58, requests: 82, resolved: 134 },
    { day: 'Wk 2', incidents: 49, requests: 76, resolved: 128 },
    { day: 'Wk 3', incidents: 44, requests: 88, resolved: 131 },
    { day: 'Wk 4', incidents: 39, requests: 74, resolved: 118 },
  ],
};

// ============================================================================
// STATUS & SLA CHIPS
// ============================================================================

function PriorityPill({ priority, dark }: { priority: Priority; dark: boolean }) {
  const styles: Record<Priority, string> = {
    URGENT: dark ? 'bg-rose-500/20 text-rose-300 border-rose-500/35' : 'bg-rose-50 text-rose-700 border-rose-200',
    HIGH: dark ? 'bg-amber-500/20 text-amber-300 border-amber-500/35' : 'bg-amber-50 text-amber-700 border-amber-200',
    MEDIUM: dark ? 'bg-sky-500/20 text-sky-300 border-sky-500/35' : 'bg-sky-50 text-sky-700 border-sky-200',
    LOW: dark ? 'bg-white/10 text-white/70 border-white/20' : 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold rounded-full border ${styles[priority]}`}>
      {priority}
    </span>
  );
}

function SlaBadge({ text, escalated, dark }: { text: string; escalated: boolean; dark: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-mono rounded-full border ${
        escalated
          ? dark
            ? 'bg-rose-500/20 text-rose-300 border-rose-400/40'
            : 'bg-rose-50 text-rose-700 border-rose-200 font-semibold'
          : dark
          ? 'bg-white/10 text-white/80 border-white/20'
          : 'bg-white/80 text-slate-700 border-slate-200'
      }`}
    >
      <Clock className="w-3 h-3" />
      {text}
    </span>
  );
}

// ============================================================================
// STANDALONE APPLE LIQUID GLASS ITMS DASHBOARD COMPONENT
// ============================================================================

export default function AppleLiquidGlassDashboard() {
  const [glassMode, setGlassMode] = useState<GlassMode>('day');
  const [activeView, setActiveView] = useState<'dashboard' | 'tickets' | 'assets' | 'cmdb'>('dashboard');
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');
  const [searchQuery, setSearchQuery] = useState('');
  const [tickets, setTickets] = useState<TicketRecord[]>(SAMPLE_TICKETS);
  const [assets] = useState<Asset[]>(SAMPLE_ASSETS);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [cmdbRootId, setCmdbRootId] = useState<string>('ast-2');
  const [toast, setToast] = useState<string | null>(null);

  const isNight = glassMode === 'night';
  const ui = getLiquidGlassClasses(isNight);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
  };

  const metrics = useMemo(() => {
    const open = tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
    const warrantyAlerts = assets.filter((a) => a.days_left >= 0 && a.days_left <= 45);
    return {
      asset_count: assets.length,
      in_stock_count: assets.filter((a) => a.status === 'IN_STOCK').length,
      open_tickets: open.length,
      overdue_tickets: open.filter((t) => t.sla_escalated).length,
      high_priority_count: open.filter((t) => t.priority === 'URGENT' || t.priority === 'HIGH').length,
      warranty_alerts_count: warrantyAlerts.length,
      license_alerts: assets.filter((a) => a.category === 'LICENSE' && a.days_left <= 30).length,
      warrantyAlerts,
    };
  }, [assets, tickets]);

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.ticket_number.toLowerCase().includes(q) ||
        t.asset_tag.toLowerCase().includes(q)
    );
  }, [tickets, searchQuery]);

  const impactedAssets = useMemo<ImpactedAsset[]>(() => {
    const visited = new Map<string, number>([[cmdbRootId, 0]]);
    const queue = [{ id: cmdbRootId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      for (const edge of CMDB_EDGES.filter((e) => e.parent === id)) {
        if (!visited.has(edge.child)) {
          visited.set(edge.child, depth + 1);
          queue.push({ id: edge.child, depth: depth + 1 });
        }
      }
    }
    visited.delete(cmdbRootId);
    const out: ImpactedAsset[] = [];
    visited.forEach((depth, id) => {
      const found = assets.find((a) => a.id === id);
      if (found) out.push({ ...found, depth });
    });
    return out.sort((a, b) => a.depth - b.depth);
  }, [cmdbRootId, assets]);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) ?? null;

  const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutGrid },
    { id: 'tickets' as const, label: 'Tickets & SLA', icon: Ticket, badge: metrics.open_tickets },
    { id: 'assets' as const, label: 'Assets & Warranty', icon: Monitor, badge: metrics.warranty_alerts_count },
    { id: 'cmdb' as const, label: 'CMDB Impact', icon: GitBranch },
  ];

  return (
    <div className={`min-h-screen relative overflow-hidden transition-colors duration-500 font-sans antialiased ${ui.canvas}`}>
      {/* Ambient Refracting Mesh Orbs (replaces AnimatedBackground.tsx) */}
      <div className={`pointer-events-none fixed -top-28 -left-24 w-[480px] h-[480px] rounded-full blur-3xl ${isNight ? 'bg-sky-500/30' : 'bg-sky-400/45'}`} />
      <div className={`pointer-events-none fixed top-1/3 right-[-120px] w-[520px] h-[520px] rounded-full blur-3xl ${isNight ? 'bg-violet-600/30' : 'bg-indigo-400/35'}`} />
      <div className={`pointer-events-none fixed -bottom-32 left-1/3 w-[460px] h-[460px] rounded-full blur-3xl ${isNight ? 'bg-teal-400/20' : 'bg-rose-300/40'}`} />

      <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6">
        {/* Floating Liquid Glass Sidebar */}
        <aside className={`hidden lg:flex w-64 shrink-0 flex-col justify-between rounded-[28px] p-4 ${ui.panel}`}>
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 px-1.5 pt-1">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-b from-[#0A84FF] to-[#0055D4] text-white flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_6px_16px_rgba(0,122,255,0.35)]">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className={`text-sm font-semibold tracking-tight ${ui.textPrimary}`}>ITMS Glass</div>
                <div className={`text-[11px] ${ui.textMuted}`}>ITAM · ITSM · CMDB</div>
              </div>
            </div>

            <nav className="space-y-1.5">
              {navItems.map((item) => {
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveView(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? isNight
                          ? 'bg-white/22 text-white border border-white/35 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]'
                          : 'bg-white/90 text-[#007AFF] border border-white shadow-[0_6px_18px_rgba(0,122,255,0.14)]'
                        : `${ui.textSecondary} hover:bg-white/20`
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </span>
                    {item.badge !== undefined && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${active ? 'bg-[#007AFF] text-white' : isNight ? 'bg-white/15 text-white/80' : 'bg-slate-900/10 text-slate-700'}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Quick ITAM Capture Dock */}
          <div className={`p-3.5 rounded-[22px] space-y-2.5 ${ui.subCard}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-semibold ${ui.textPrimary}`}>Quick Capture</span>
              <span className="w-2 h-2 rounded-full bg-[#34C759]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => notify('Open InvoiceAssetUpload modal')}
                className={`py-2 px-2 rounded-2xl text-[11px] font-medium flex items-center justify-center gap-1 ${isNight ? 'bg-white/10 text-white' : 'bg-white/85 text-slate-800'}`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#007AFF]" /> Invoice
              </button>
              <button
                onClick={() => notify('Navigate to /scan')}
                className={`py-2 px-2 rounded-2xl text-[11px] font-medium flex items-center justify-center gap-1 ${isNight ? 'bg-white/10 text-white' : 'bg-white/85 text-slate-800'}`}
              >
                <QrCode className="w-3.5 h-3.5 text-[#AF52DE]" /> Scan QR
              </button>
            </div>
          </div>
        </aside>

        {/* Main Liquid Glass Stage */}
        <main className="flex-1 space-y-5 min-w-0">
          {/* Top Floating Glass Capsule Toolbar */}
          <header className={`rounded-[26px] px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 ${ui.panel}`}>
            <div>
              <div className={`text-[11px] font-medium ${ui.textMuted}`}>Apple Liquid Glass · ITMS</div>
              <h1 className={`text-lg sm:text-xl font-semibold tracking-tight ${ui.textPrimary}`}>
                {activeView === 'dashboard' && 'Operations Control'}
                {activeView === 'tickets' && 'Service Desk & SLA'}
                {activeView === 'assets' && 'Assets & Warranty'}
                {activeView === 'cmdb' && 'CMDB Impact Lens'}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className={`flex items-center p-1 rounded-full ${ui.pill}`}>
                <button
                  onClick={() => setGlassMode('day')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${!isNight ? 'bg-white text-slate-900 shadow-xs' : 'text-white/70'}`}
                >
                  Day Glass
                </button>
                <button
                  onClick={() => setGlassMode('night')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${isNight ? 'bg-white/25 text-white shadow-xs' : 'text-slate-600'}`}
                >
                  Night Glass
                </button>
              </div>
              <button
                onClick={() => notify('Wire to AddAssetForm modal')}
                className={`px-3.5 py-2 rounded-full text-xs font-medium flex items-center gap-1 ${ui.pill} ${ui.textPrimary}`}
              >
                <Box className="w-3.5 h-3.5" /> Add Asset
              </button>
              <button
                onClick={() => notify('Wire to CreateTicket modal')}
                className="px-4 py-2 rounded-full bg-gradient-to-b from-[#0A84FF] to-[#0066D6] text-white text-xs font-semibold shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_20px_rgba(0,122,255,0.35)] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> New Ticket
              </button>
            </div>
          </header>

          {activeView === 'dashboard' && (
            <>
              {/* KPI Lenses */}
              <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: 'Total Assets', val: metrics.asset_count, sub: `${metrics.in_stock_count} in stock`, dot: '#007AFF', icon: Monitor },
                  { label: 'Open Tickets', val: metrics.open_tickets, sub: `${metrics.high_priority_count} high / urgent`, dot: '#AF52DE', icon: Ticket },
                  { label: 'SLA Escalated', val: metrics.overdue_tickets, sub: 'Breach monitor', dot: '#FF3B30', icon: AlertTriangle },
                  { label: 'Warranty & License', val: metrics.warranty_alerts_count + metrics.license_alerts, sub: 'Expiring ≤ 45d', dot: '#FF9500', icon: ShieldCheck },
                ].map((k) => (
                  <div key={k.label} className={`rounded-[26px] p-5 transition-transform hover:-translate-y-0.5 ${ui.panel}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${ui.textSecondary}`}>{k.label}</span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: k.dot }}>
                        <k.icon className="w-4 h-4" />
                      </div>
                    </div>
                    <div className={`text-3xl font-bold tracking-tight mt-3 ${ui.textPrimary}`}>{k.val}</div>
                    <div className={`text-xs mt-1 ${ui.textMuted}`}>{k.sub}</div>
                  </div>
                ))}
              </section>

              {/* Chart + Expiring Soon */}
              <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className={`xl:col-span-8 rounded-[28px] p-5 sm:p-6 ${ui.panel}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className={`text-sm font-semibold ${ui.textPrimary}`}>Service Velocity & Resolution</h2>
                      <p className={`text-xs ${ui.textMuted}`}>Incidents vs resolved throughput</p>
                    </div>
                    <div className={`flex p-0.5 rounded-full ${ui.pill}`}>
                      {(['7d', '30d'] as const).map((r) => (
                        <button key={r} onClick={() => setTimeRange(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium ${timeRange === r ? 'bg-[#007AFF] text-white' : ui.textSecondary}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={VELOCITY_DATA[timeRange]}>
                        <defs>
                          <linearGradient id="algBlue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#007AFF" stopOpacity={0.38} />
                            <stop offset="95%" stopColor="#007AFF" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="algGreen" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34C759" stopOpacity={0.32} />
                            <stop offset="95%" stopColor="#34C759" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={isNight ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)'} />
                        <XAxis dataKey="day" stroke={isNight ? '#cbd5e1' : '#475569'} fontSize={11} />
                        <YAxis stroke={isNight ? '#cbd5e1' : '#475569'} fontSize={11} />
                        <Tooltip />
                        <Area type="monotone" dataKey="resolved" stroke="#34C759" fill="url(#algGreen)" strokeWidth={2.5} />
                        <Area type="monotone" dataKey="incidents" stroke="#007AFF" fill="url(#algBlue)" strokeWidth={2.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={`xl:col-span-4 rounded-[28px] p-5 sm:p-6 flex flex-col justify-between space-y-4 ${ui.panel}`}>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h2 className={`text-sm font-semibold ${ui.textPrimary}`}>Expiring Soon</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FF9500]/20 text-[#FF9500]">
                        {metrics.warrantyAlerts.length} Alerts
                      </span>
                    </div>
                    {metrics.warrantyAlerts.map((w) => (
                      <div key={w.id} className={`p-3.5 rounded-[20px] flex items-center justify-between gap-2 ${ui.subCard}`}>
                        <div className="min-w-0">
                          <div className={`text-xs font-semibold truncate ${ui.textPrimary}`}>{w.name}</div>
                          <div className={`text-[11px] font-mono ${ui.textMuted}`}>{w.asset_tag} · {w.warranty_expiry}</div>
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-[#FF9500] text-white font-mono text-[11px] font-bold">{w.days_left}d</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setActiveView('cmdb')} className={`w-full py-2.5 rounded-full text-xs font-semibold ${ui.subCard} ${ui.textPrimary}`}>
                    Open CMDB Impact Lens →
                  </button>
                </div>
              </section>

              {/* Service Queue */}
              <section className={`rounded-[28px] p-5 sm:p-6 space-y-3 ${ui.panel}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className={`text-sm font-semibold ${ui.textPrimary}`}>Live Service Queue</h2>
                  <div className="relative">
                    <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${ui.textMuted}`} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter tickets..."
                      className={`pl-8 pr-4 py-1.5 rounded-full text-xs focus:outline-none ${ui.pill} ${ui.textPrimary}`}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  {filteredTickets.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTicketId(t.id)}
                      className={`p-3.5 rounded-[20px] cursor-pointer flex flex-wrap items-center justify-between gap-3 transition ${ui.subCard}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#007AFF]">{t.ticket_number}</span>
                          <span className={`text-xs sm:text-sm font-medium truncate ${ui.textPrimary}`}>{t.title}</span>
                        </div>
                        <div className={`text-[11px] mt-0.5 ${ui.textMuted}`}>CI: {t.asset_tag} · Assignee: {t.assignee_name}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <PriorityPill priority={t.priority} dark={isNight} />
                        <SlaBadge text={t.sla_due_at} escalated={t.sla_escalated} dark={isNight} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeView === 'tickets' && (
            <section className={`rounded-[28px] p-5 space-y-2.5 ${ui.panel}`}>
              {filteredTickets.map((t) => (
                <div key={t.id} onClick={() => setSelectedTicketId(t.id)} className={`p-4 rounded-[20px] cursor-pointer flex flex-wrap justify-between items-center gap-2 ${ui.subCard}`}>
                  <div>
                    <div className="font-mono text-xs font-semibold text-[#007AFF]">{t.ticket_number}</div>
                    <div className={`text-sm font-medium ${ui.textPrimary}`}>{t.title}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PriorityPill priority={t.priority} dark={isNight} />
                    <SlaBadge text={t.sla_due_at} escalated={t.sla_escalated} dark={isNight} />
                  </div>
                </div>
              ))}
            </section>
          )}

          {activeView === 'assets' && (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {assets.map((a) => (
                <div key={a.id} className={`rounded-[26px] p-5 space-y-2.5 ${ui.panel}`}>
                  <div className="font-mono text-xs font-semibold text-[#007AFF]">{a.asset_tag}</div>
                  <div className={`text-sm font-semibold ${ui.textPrimary}`}>{a.name}</div>
                  <div className={`text-xs ${ui.textMuted}`}>{a.vendor_name} · {a.location_name}</div>
                  <div className={`text-xs pt-2 border-t ${isNight ? 'border-white/15' : 'border-slate-900/10'} flex justify-between ${ui.textSecondary}`}>
                    <span>{a.assigned_user_name}</span>
                    <span className="font-mono font-semibold">₹{(a.current_value / 1000).toFixed(0)}k</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          {activeView === 'cmdb' && (
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className={`lg:col-span-5 rounded-[28px] p-5 space-y-2.5 ${ui.panel}`}>
                <div className="text-xs font-semibold text-[#007AFF]">1. Select Root Asset (CI)</div>
                {assets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setCmdbRootId(a.id)}
                    className={`w-full text-left p-3 rounded-[18px] transition ${
                      cmdbRootId === a.id ? 'bg-[#007AFF] text-white' : `${ui.subCard} ${ui.textPrimary}`
                    }`}
                  >
                    <div className="font-mono text-[11px] opacity-80">{a.asset_tag}</div>
                    <div className="text-xs font-semibold">{a.name}</div>
                  </button>
                ))}
              </div>
              <div className={`lg:col-span-7 rounded-[28px] p-5 space-y-3 ${ui.panel}`}>
                <div className="text-xs font-semibold text-[#FF3B30]">
                  2. Downstream Blast Radius ({impactedAssets.length} impacted assets)
                </div>
                {impactedAssets.map((imp) => (
                  <div key={imp.id} className={`p-3.5 rounded-[18px] flex justify-between items-center ${ui.subCard}`}>
                    <div>
                      <div className={`text-xs font-semibold ${ui.textPrimary}`}>{imp.name} ({imp.asset_tag})</div>
                      <div className={`text-[11px] ${ui.textMuted}`}>{imp.location_name} · {imp.assigned_user_name}</div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-[#AF52DE]/20 text-[#AF52DE] font-mono text-[11px] font-bold">
                      DEPTH {imp.depth}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Ticket Slide-over Drawer */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTicketId(null)}>
          <div className={`w-full max-w-md h-full p-6 flex flex-col justify-between ${ui.panel}`} onClick={(e) => e.stopPropagation()}>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-mono text-xs font-bold text-[#007AFF]">{selectedTicket.ticket_number}</span>
                <button onClick={() => setSelectedTicketId(null)} className={`p-1.5 rounded-full ${ui.subCard}`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <h3 className={`text-base font-semibold ${ui.textPrimary}`}>{selectedTicket.title}</h3>
              <p className={`text-xs leading-relaxed ${ui.textSecondary}`}>{selectedTicket.description}</p>
              <div className="flex gap-2">
                <PriorityPill priority={selectedTicket.priority} dark={isNight} />
                <SlaBadge text={selectedTicket.sla_due_at} escalated={selectedTicket.sla_escalated} dark={isNight} />
              </div>
              <div>
                <label className={`block text-[11px] mb-1 ${ui.textMuted}`}>Update Status</label>
                <select
                  value={selectedTicket.status}
                  onChange={(e) => {
                    const next = e.target.value as TicketStatus;
                    setTickets((prev) => prev.map((t) => (t.id === selectedTicket.id ? { ...t, status: next } : t)));
                    notify(`Updated ${selectedTicket.ticket_number} -> ${next}`);
                  }}
                  className={`w-full rounded-2xl px-3 py-2 text-xs ${ui.pill} ${ui.textPrimary}`}
                >
                  <option value="OPEN">OPEN</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-full bg-slate-900/90 text-white border border-white/20 shadow-xl flex items-center gap-2 text-xs font-medium backdrop-blur-xl">
          <CheckCircle2 className="w-4 h-4 text-[#34C759]" />
          {toast}
        </div>
      )}
    </div>
  );
}