import {
  BadgeCheck,
  BarChart3,
  QrCode,
  Tags,
  BookOpen,
  Boxes,
  ClipboardList,
  Database,
  LayoutDashboard,
  Network,
  ScrollText,
  ShieldCheck,
  Ticket,
  UserRoundCheck,
  Settings as SettingsIcon,
  Headset,
  ScanLine,
  TrendingUp,
  Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuthUser } from '@/api/types';

export interface NavChild {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  admin?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Whole group hidden from non-admins (children should also carry admin). */
  admin?: boolean;
  /** Single-child group (Dashboard) — renders as a flat row, not a parent. */
  single?: boolean;
  children: NavChild[];
}

/**
 * Single source of truth for app navigation (sidebar + mobile bottom nav).
 * Keep in this ONE array — the licenses PR (#100) showed what happens when
 * Layout.tsx and BottomNav.tsx drift: new modules became unreachable on mobile.
 *
 * Display order (sidebar top→bottom, More-sheet section order) is array order.
 * Mobile primaries intentionally do NOT follow this order — see MOBILE_LEAF_ORDER.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    single: true,
    children: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: Boxes,
    children: [
      { to: '/assets', label: 'Assets', icon: Boxes },
      { to: '/warranty', label: 'Warranty', icon: ShieldCheck },
      { to: '/licenses', label: 'Licenses', icon: BadgeCheck, admin: true },
    ],
  },
  {
    id: 'service',
    label: 'Service Desk',
    icon: Headset,
    children: [
      { to: '/tickets', label: 'Tickets', icon: Ticket },
      { to: '/requests', label: 'Requests', icon: ClipboardList },
      { to: '/kb', label: 'Knowledge', icon: BookOpen },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: ScanLine,
    children: [
      { to: '/onboarding', label: 'Join/Leave', icon: UserRoundCheck },
      { to: '/scan', label: 'Scan', icon: QrCode },
      { to: '/labels', label: 'Labels', icon: Tags },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: TrendingUp,
    children: [
      { to: '/cmdb', label: 'CMDB', icon: Network },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/audit', label: 'Audit Log', icon: ScrollText },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: Lock,
    admin: true,
    children: [
      { to: '/masters', label: 'Masters', icon: Database, admin: true },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, admin: true },
    ],
  },
];

/**
 * Frozen pre-grouping leaf order. The mobile bottom bar's primaries/rest split
 * follows THIS order (never the tree order) so grouping can never reshuffle
 * the bar. Add new modules here deliberately; never reorder existing entries.
 */
export const MOBILE_LEAF_ORDER: string[] = [
  '/',
  '/assets',
  '/tickets',
  '/licenses',
  '/warranty',
  '/onboarding',
  '/requests',
  '/cmdb',
  '/audit',
  '/kb',
  '/reports',
  '/scan',
  '/labels',
  '/masters',
  '/settings',
];

type MaybeUser = Pick<AuthUser, 'role'> | null | undefined;
const isAdmin = (user: MaybeUser): boolean => user?.role === 'ADMIN';
const isVisible = (child: NavChild, user: MaybeUser): boolean => !child.admin || isAdmin(user);

/** Leaf lookup by path — throws on unknown paths to keep MOBILE_LEAF_ORDER honest. */
function childByPath(to: string): NavChild {
  for (const group of NAV_GROUPS) {
    const found = group.children.find((c) => c.to === to);
    if (found) return found;
  }
  throw new Error(`MOBILE_LEAF_ORDER references unknown nav path: ${to}`);
}

/** Role-filtered group tree; admin-only and childless groups are dropped. */
export function visibleNavGroups(user: MaybeUser): NavGroup[] {
  return NAV_GROUPS.filter((g) => !g.admin || isAdmin(user))
    .map((g) => ({ ...g, children: g.children.filter((c) => isVisible(c, user)) }))
    .filter((g) => g.children.length > 0);
}

/**
 * Flat role-filtered leaf list in the FROZEN pre-grouping order.
 * Private helper behind primaryNav — tree consumers use visibleNavGroups /
 * primaryNav / restGroups instead.
 */
function visibleNav(user: MaybeUser): NavChild[] {
  return MOBILE_LEAF_ORDER.map(childByPath).filter((c) => isVisible(c, user));
}

/** Mobile bottom-bar primaries: first 4 visible leaves in frozen order. */
export function primaryNav(user: MaybeUser): NavChild[] {
  return visibleNav(user).slice(0, 4);
}

/** Mobile More-sheet sections: visible groups minus primaries, tree order, no empties. */
export function restGroups(user: MaybeUser): NavGroup[] {
  const primaries = new Set(primaryNav(user).map((c) => c.to));
  return visibleNavGroups(user)
    .map((g) => ({ ...g, children: g.children.filter((c) => !primaries.has(c.to)) }))
    .filter((g) => g.children.length > 0);
}
