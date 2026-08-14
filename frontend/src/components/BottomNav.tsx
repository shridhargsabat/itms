import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Database,
  LayoutDashboard,
  Network,
  ScrollText,
  Ticket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCachedUser } from '@/api/client';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/masters', label: 'Masters', icon: Database, admin: true },
];

/** SAPL-style compact glassy bottom nav — mobile only (desktop keeps the sidebar). */
export default function BottomNav() {
  const user = getCachedUser();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-900 lg:hidden">
      <div className="flex h-14 items-stretch">
        {NAV_ITEMS.filter((i) => !i.admin || user?.role === 'ADMIN').map(({ to, label, icon: Icon, end }) => (
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
