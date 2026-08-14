import { NavLink } from 'react-router-dom';
import {
  Boxes,
  LayoutDashboard,
  Network,
  ScrollText,
  Ticket,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
];

/** SAPL-style compact glassy bottom nav — mobile only (desktop keeps the sidebar). */
export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-slate-800/80 bg-slate-900/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1',
              isActive ? 'text-indigo-400' : 'text-slate-500',
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
                  'max-w-full truncate text-[10.5px] leading-none',
                  isActive ? 'font-semibold' : 'font-medium',
                )}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
