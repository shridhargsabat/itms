import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AnimatedBackground from '@/components/AnimatedBackground';
import ThemeToggle from '@/components/ThemeToggle';
import { Button } from '@/components/Button';
import { applyTheme, watchSystemTheme } from '@/lib/theme';
import {
  Download,
  KeyRound,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { visibleNav } from '@/lib/nav';
import OfflineBanner from '@/components/OfflineBanner';
import UpdateToast from '@/components/UpdateToast';
import BottomNav from '@/components/BottomNav';
import NotificationsBell from '@/components/NotificationsBell';
import { clearSession, getCachedUser, logout } from '@/api/client';
import { usePwaInstallable } from '@/lib/pwa';

export default function Layout() {
  // User's persistent rail choice (collapsed / expanded), remembered across reloads.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('itms_sidebar_collapsed') === '1',
  );
  // Transient hover expand: when the collapsed rail is hovered it peeks open (overlay).
  const [hovering, setHovering] = useState(false);
  const [showIosTip, setShowIosTip] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const user = getCachedUser();
  const { installable, promptInstall } = usePwaInstallable();
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  // Effective sidebar width: hover temporarily overrides a user-collapsed rail so it
  // peeks open, then snaps back when the pointer leaves.
  const wide = !collapsed || hovering;

  const toggleSidebar = () => {
    setCollapsed((c) => {
      const next = !c;
      // Keep the user's persistent choice across reloads (matches itms_theme pattern).
      localStorage.setItem('itms_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

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
      <header className="sticky top-0 z-40 flex items-center gap-2 glass-chrome px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Network className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-primary">ITMS</span>
        <div className="ml-auto min-w-0 text-right leading-tight">
          <span className="block truncate text-xs text-secondary">{user?.name ?? user?.email ?? ''}</span>
          <span className="block text-[9px] text-muted">build {__BUILD_SHA__}</span>
        </div>
        <NotificationsBell />
        <Button
          type="button"
          onClick={handleInstall}
          aria-label="Install app"
          title={isIOS ? 'Install via Share → Add to Home Screen' : 'Install app'}
          variant="ghost"
          className="h-11 w-11 shrink-0 hover:text-accent"
        >
          <Download className="h-5 w-5" />
        </Button>
        <ThemeToggle className="h-11 w-11 rounded-lg text-secondary hover:text-accent" />
        <Button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          variant="ghost"
          className="h-11 w-11 shrink-0 hover:text-red-400"
        >
          <LogOut className="h-5 w-5" />
        </Button>
      </header>
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          'fixed inset-y-0 left-0 hidden flex-col glass-chrome transition-all duration-300 lg:flex',
          wide ? 'w-60' : 'w-16',
          // Transient hover peek overlays the page (higher z + shadow, content not pushed).
          hovering && collapsed && 'z-[60] shadow-2xl',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center border-b border-edge px-4',
            wide ? 'justify-start gap-3' : 'justify-center px-0',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Network className="h-4 w-4" />
          </span>
          {wide && (
            <span className="truncate text-sm font-semibold tracking-wide text-primary">
              ITMS
            </span>
          )}
          {wide && (
            <NotificationsBell className="ml-auto" />
          )}
        </div>

        {/* min-h-0 + overflow-y-auto: the nav scrolls internally so the footer
            (user card, collapse/sign-out, theme toggle) stays pinned even when
            16 items exceed a short viewport (#173: the toggle was pushed below
            the fold on hover-peek, which also renders the user card). */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {visibleNav(user).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed && !hovering ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  wide ? '' : 'justify-center px-0',
                  isActive
                    ? 'bg-elevated text-primary'
                    : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {wide && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {wide && user && (
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
          <Button
            type="button"
            onClick={toggleSidebar}
            variant="ghost"
            className={cn(
              'w-full justify-start gap-3 px-3 py-2 text-sm',
              wide ? '' : 'justify-center px-0',
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
          </Button>
          <Button
            type="button"
            onClick={signOut}
            variant="ghost"
            className={cn(
              'mt-1 w-full justify-start gap-3 px-3 py-2 text-sm text-muted hover:bg-red-500/10 hover:text-red-400',
              wide ? '' : 'justify-center px-0',
            )}
            title="Sign out"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {wide && <span>Sign out</span>}
          </Button>
          <Link
            to="/account"
            className={cn(
              'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-accent/10 hover:text-accent',
              wide ? '' : 'justify-center px-0',
            )}
            title="Change password"
          >
            <KeyRound className="h-5 w-5 shrink-0" />
            {wide && <span>Change password</span>}
          </Link>
          {installable && (
            <Button
              type="button"
              onClick={promptInstall}
              variant="ghost"
              className={cn(
                'mt-1 w-full justify-start gap-3 px-3 py-2 text-sm text-muted hover:text-accent',
                wide ? '' : 'justify-center px-0',
              )}
              title="Install app"
            >
              <Download className="h-4 w-4 shrink-0" />
              {wide && <span>Install app</span>}
            </Button>
          )}
          <div className={cn('mt-1', wide && 'px-2')}>
            <ThemeToggle className={cn('w-full', wide ? 'h-9' : 'h-9 w-9')} />
          </div>
          {wide && (
            <p className="mt-2 px-2 text-center text-[10px] text-muted">build {__BUILD_SHA__}</p>
          )}
        </div>
      </aside>

      {showIosTip && (
        <div className="animate-fade-in fixed right-4 top-[calc(2.8125rem+env(safe-area-inset-top))] z-[60] max-w-[260px] rounded-lg border border-edge2 bg-elevated px-3 py-2 text-xs text-primary shadow-2xl">
          Tap <b className="text-primary">Share</b> → <b className="text-primary">Add to Home Screen</b>{' '}
          to install ITMS like an app
        </div>
      )}

      <main
        className={cn(
          'relative z-[1] transition-all duration-300',
          'ml-0 pb-24 lg:pb-8', // pb clears the mobile bottom nav (56px + safe area)
          // Desktop: lock the app to the viewport so the page itself never
          // scrolls — only the DataTable's inner overflow-y-auto (and this
          // wrapper, for any non-table overflow) scrolls. Removes the
          // redundant outer page scrollbar seen next to the window controls.
          'lg:flex lg:h-screen lg:flex-col lg:overflow-hidden',
          collapsed ? 'lg:ml-16' : 'lg:ml-60',
        )}
      >
        {/* Full-width scroll frame. Its scrollbar must sit at the window's
            far-right edge, so the max-w-7xl centering below CANNOT live on this
            frame — a centered 7xl box on a >1520px screen floats its scrollbar
            mid-window (the "scrollbar in the middle" bug). Keep this frame
            full-width with the page PADDING OWNED BY THE FRAME: vertical padding
            on an inner wrapper would count against the frame's scrollHeight and
            make it overflow a few px, re-adding a second (page) scrollbar next
            to a table's inner one. */}
        <div className="w-full flex-1 p-6 lg:min-h-0 lg:overflow-y-auto lg:p-8">
          {/* Centered, width-capped content column (readability width).
              No vertical padding here (see frame comment above).
              keyed by pathname: fresh entrance per route change.
              NOTE: opacity-only — a transform here would make every
              position:fixed descendant (sheets, drawers, dropdowns)
              position against this element instead of the viewport. */}
          <div className="mx-auto w-full max-w-7xl">
            {/* No animation class on the route wrapper: opacity-only entrance
                animations froze at 0 on iOS when the app was backgrounded,
                hiding the whole page (and a transform would break fixed
                children). View Transitions provides the crossfade. */}
            <div key={location.pathname}>
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
