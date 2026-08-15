import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AnimatedBackground from '@/components/AnimatedBackground';
import ThemeToggle from '@/components/ThemeToggle';
import { applyTheme, watchSystemTheme } from '@/lib/theme';
import {
  Boxes,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateToast from '@/components/UpdateToast';
import BottomNav from '@/components/BottomNav';
import { clearSession, getCachedUser, logout } from '@/api/client';
import { usePwaInstallable } from '@/lib/pwa';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/warranty', label: 'Warranty', icon: ShieldCheck },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/cmdb', label: 'CMDB', icon: Network },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/masters', label: 'Masters', icon: Database, admin: true },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [showIosTip, setShowIosTip] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const user = getCachedUser();
  const { installable, promptInstall } = usePwaInstallable();
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const signOut = async () => {
    await logout().catch(() => {});
    clearSession();
    navigate('/login', { replace: true });
  };

  const handleInstall = () => {
    if (installable) {
      promptInstall();
    } else if (isIOS) {
      setShowIosTip(true);
      window.setTimeout(() => setShowIosTip(false), 6000);
    }
  };

  // Smooth page transitions via the View Transitions API (Chromium/Safari 18+).
  // Intercepts internal <a> clicks and wraps the navigation so the browser
  // crossfades between screens. No transforms on wrappers — that would break
  // position:fixed children (see dropdown alignment incident).
  useEffect(() => {
    applyTheme();
    watchSystemTheme();
    // Every navigation starts at the top (SPA convention). Phones resumed
    // mid-page and reported the dashboard actions as "missing" — they were
    // just scrolled above the fold; combined with the sticky actions row
    // this makes the add buttons effectively always reachable.
    window.scrollTo(0, 0);
    if (!('startViewTransition' in document)) return;
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      ) {
        return;
      }
      const anchor = (e.target as Element).closest('a[href^="/"]');
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http')) return;
      e.preventDefault();
      document.startViewTransition(() => {
        navigate(href);
      });
    };
    // Capture phase: runs BEFORE react-router's Link handler, so we can
    // preventDefault first and wrap the navigation in a view transition.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate, location.pathname]);

  return (
    <div className="min-h-screen">
      <AnimatedBackground />
      <OfflineBanner />
      <UpdateToast />
      <BottomNav />
      {/* Mobile top bar (sidebar is hidden <lg): brand + user + logout */}
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-edge/60 bg-base/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-lg lg:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Network className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-primary">ITMS</span>
        <div className="ml-auto min-w-0 text-right leading-tight">
          <span className="block truncate text-xs text-secondary">{user?.name ?? user?.email ?? ''}</span>
          <span className="block text-[9px] text-muted">build {__BUILD_SHA__}</span>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          aria-label="Install app"
          title={isIOS ? 'Install via Share → Add to Home Screen' : 'Install app'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-elevated/60 hover:text-accent"
        >
          <Download className="h-5 w-5" />
        </button>
        <ThemeToggle className="h-11 w-11 rounded-lg text-secondary hover:text-accent" />
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-elevated/60 hover:text-red-400"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-edge bg-surface/80 backdrop-blur transition-all duration-300 lg:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center border-b border-edge px-4',
            collapsed ? 'justify-center px-0' : 'gap-3',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Network className="h-4 w-4" />
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-wide text-primary">
              ITMS
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.filter((i) => !i.admin || user?.role === 'ADMIN').map(({ to, label, icon: Icon, end }) => (
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
                    ? 'bg-elevated text-primary'
                    : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {!collapsed && user && (
          <div className="flex items-center gap-3 border-t border-edge px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
              {(user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium text-primary">{user.name ?? user.email}</p>
              <p className="truncate text-[11px] text-muted">
                {user.role ?? ''} · build {__BUILD_SHA__}
              </p>
            </div>
          </div>
        )}

        <div className="p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-elevated/60 hover:text-primary',
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
          <button
            type="button"
            onClick={signOut}
            className={cn(
              'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-red-500/10 hover:text-red-400',
              collapsed && 'justify-center px-0',
            )}
            title="Sign out"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
          {installable && (
            <button
              type="button"
              onClick={promptInstall}
              className={cn(
                'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated/60 hover:text-accent',
                collapsed && 'justify-center px-0',
              )}
              title="Install app"
            >
              <Download className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Install app</span>}
            </button>
          )}
          <div className={cn('mt-1', !collapsed && 'px-2')}>
            <ThemeToggle className={cn('w-full', collapsed ? 'h-9 w-9' : 'h-9')} />
          </div>
          {!collapsed && (
            <p className="mt-2 px-2 text-center text-[10px] text-muted">build {__BUILD_SHA__}</p>
          )}
        </div>
      </aside>

      {showIosTip && (
        <div className="animate-fade-in fixed right-4 top-[calc(2.8125rem+env(safe-area-inset-top))] z-[60] max-w-[260px] rounded-lg border border-edge2 bg-elevated px-3 py-2 text-xs text-primary shadow-2xl">
          Tap <b className="text-white">Share</b> → <b className="text-white">Add to Home Screen</b>{' '}
          to install ITMS like an app
        </div>
      )}

      <main
        className={cn(
          'relative z-[1] min-h-screen transition-all duration-300',
          'ml-0 pb-24 lg:pb-8', // pb clears the mobile bottom nav (56px + safe area)
          collapsed ? 'lg:ml-16' : 'lg:ml-60',
        )}
      >
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
          {/* keyed by pathname: fresh entrance per route change.
              NOTE: opacity-only — a transform here would make every
              position:fixed descendant (sheets, drawers, dropdowns)
              position against this element instead of the viewport. */}
          {/* No animation class on the route wrapper: opacity-only entrance
              animations froze at 0 on iOS when the app was backgrounded,
              hiding the whole page (and a transform would break fixed
              children). View Transitions provides the crossfade. */}
          <div key={location.pathname}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
