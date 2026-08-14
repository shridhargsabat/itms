import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Boxes,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Ticket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateToast from '@/components/UpdateToast';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen">
      <OfflineBanner />
      <UpdateToast />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-800 bg-slate-900/80 backdrop-blur transition-all duration-300',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center border-b border-slate-800 px-4',
            collapsed ? 'justify-center px-0' : 'gap-3',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <Network className="h-4 w-4" />
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-wide text-slate-100">
              ITMS
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-800 p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-200',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-5 w-5 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main
        className={cn(
          'min-h-screen transition-all duration-300',
          collapsed ? 'ml-16' : 'ml-60',
        )}
      >
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
