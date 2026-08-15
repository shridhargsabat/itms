import { NavLink } from 'react-router-dom';
import {
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Network,
  ShieldCheck,
  Ticket,
  UserRoundCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/warranty', label: 'Warranty', icon: ShieldCheck },
  { to: '/onboarding', label: 'Join/Leave', icon: UserRoundCheck },
  { to: '/requests', label: 'Requests', icon: ClipboardList },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  // Masters + Audit Log are desktop-only (sidebar) — 8 items overflow 375px.
];

/** SAPL-style compact glassy bottom nav — mobile only (desktop keeps the sidebar). */
export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-edge bg-surface lg:hidden">
      <div className="flex h-14 items-stretch">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1',
                isActive ? 'text-accent' : 'text-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('h-5 w-5 transition-transform', isActive && 'scale-110')}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span
                  className={cn(
                    'text-[10.5px] leading-none',
                    isActive ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
