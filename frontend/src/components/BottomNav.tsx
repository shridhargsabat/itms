import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { visibleNav } from '@/lib/nav';
import { getCachedUser } from '@/api/client';
import { cn } from '@/lib/utils';

/**
 * Mobile-only bottom navigation — SAPL-style: 4 primary tabs + a "More" sheet
 * with every remaining section, so ALL nav destinations are reachable at
 * 375px (the bar itself caps at 7 cells; anything beyond the first 4 tabs
 * lives in the sheet). Desktop keeps the sidebar (this is hidden on lg+).
 *
 * The bar deliberately has NO env(safe-area-inset-bottom) padding — the
 * accepted flush-to-bottom SAPL-matching look (see mobile-webapp-ui skill).
 * The sheet panel DOES pad for the safe area.
 */
export default function BottomNav() {
  const { pathname } = useLocation();
  const user = getCachedUser();
  const [more, setMore] = useState(false);

  // Close the sheet on navigation.
  useEffect(() => {
    setMore(false);
  }, [pathname]);

  const links = visibleNav(user);
  if (links.length === 0) return null; // signed out / public page

  const primary = links.slice(0, 4);
  const rest = links.slice(4);

  const cell = (active: boolean) =>
    'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors ' +
    (active ? 'text-accent' : 'text-muted');

  return (
    <>
      {/* "More" sheet — every remaining section */}
      {more && rest.length > 0 && (
        <div className="lg:hidden fixed inset-0 z-[55]">
          <div
            className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMore(false)}
          />
          <div className="animate-sheet-up absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-edge2 bg-elevated/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_44px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150">
            <div className="flex justify-center pb-1 pt-3">
              <span className="h-1 w-10 rounded-full bg-edge" />
            </div>
            <p className="px-5 pb-2 pt-1 text-[9px] uppercase tracking-[0.2em] text-muted">
              All sections
            </p>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-4">
              {rest.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMore(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center gap-1.5 rounded-xl py-3 text-center transition-colors',
                      isActive
                        ? 'bg-accent/15 text-accent'
                        : 'text-secondary hover:bg-elevated2 hover:text-primary',
                    )
                  }
                >
                  <Icon className="h-5 w-5" strokeWidth={2} />
                  <span className="text-[10.5px] leading-tight tracking-wide">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-edge bg-surface lg:hidden">
        <div className="flex h-14 items-stretch">
          {primary.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cell(isActive)}
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
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-label="More sections"
              aria-expanded={more}
              className={cn(cell(more), 'text-[10.5px] leading-none')}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="4" cy="9" r="1.35" fill="currentColor" />
                <circle cx="9" cy="9" r="1.35" fill="currentColor" />
                <circle cx="14" cy="9" r="1.35" fill="currentColor" />
              </svg>
              <span className="text-[10.5px] leading-none font-medium">More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
