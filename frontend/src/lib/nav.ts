import {
  BadgeCheck,
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuthUser } from '@/api/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  admin?: boolean;
}

/**
 * Single source of truth for app navigation (sidebar + mobile bottom nav).
 * Keep in this ONE array — the licenses PR (#100) showed what happens when
 * Layout.tsx and BottomNav.tsx drift: new modules became unreachable on mobile.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/licenses', label: 'Licenses', icon: BadgeCheck, admin: true },
  { to: '/warranty', label: 'Warranty', icon: ShieldCheck },
  { to: '/onboarding', label: 'Join/Leave', icon: UserRoundCheck },
  { to: '/requests', label: 'Requests', icon: ClipboardList },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/kb', label: 'Knowledge', icon: BookOpen },
  { to: '/masters', label: 'Masters', icon: Database, admin: true },
];

/** Role-filtered nav list — admin-only items visible to ADMIN role only. */
export function visibleNav(user?: Pick<AuthUser, 'role'> | null): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.admin || user?.role === 'ADMIN');
}
