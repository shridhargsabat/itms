import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { primaryNav, restGroups } from '@/lib/nav';
import { getCachedUser } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/Button';

/**
 * Mobile-only bottom navigation — SAPL-style: 4 primary tabs + a "More" sheet
 * with every remaining section, so ALL nav destinations are reachable at
 * 375px (the bar itself caps at 7 cells; anything beyond the first 4 tabs
 * lives in the sheet). Desktop keeps the sidebar (this is hidden on lg+).
 *
 * The bar deliberately has NO env(safe-area-inset-bottom) padding — the
 * floating capsule keeps the flush-content rule (no extra safe-area padding
 * on the bar itself). The sheet panel DOES pad for the safe area.
 */
export default function BottomNav() {
  const { pathname } = useLocation();
  const user = getCachedUser();
  const [more, setMore] = useState(false);

  // Close the sheet on navigation.
  useEffect(() => {
    setMore(false);
  }, [pathname]);

  // UX-45 (#219): the floating capsule overlays document-scrolled content on
  // mobile — bottom scroll-padding (matching Layout's pb-24 end clearance)
  // so scrollIntoView/anchor rests clear the capsule mid-scroll too.
  useEffect(() => {
    document.documentElement.style.scrollPaddingBottom = '6rem';
    return () => {
      document.documentElement.style.scrollPaddingBottom = '';
    };
  }, []);

  // Primaries follow the FROZEN pre-grouping order (never the tree order), so
  // grouping can never reshuffle the bar. The sheet shows the same groups as
  // the desktop sidebar minus the primaries (no empty sections).
  const primary = primaryNav(user);
  const groups = restGroups(user);
  if (primary.length === 0 && groups.length === 0) return null; // signed out / public page

  const cell = (active: boolean) =>
    'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors ' +
    (active ? 'text-accent' : 'text-muted');

  return (
    <>
      {/* "More" sheet — every remaining section, grouped like the sidebar */}
      {more && groups.length > 0 && (
        <div className="lg:hidden fixed inset-0 z-[55]">
          <div
            className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMore(false)}
          />
          {/* intentional literal shadow (no shadow-color token exists; task-14 sweep) */}
          <div className="animate-sheet-up absolute inset-x-4 bottom-4 max-h-[80vh] overflow-y-auto rounded-[26px] glass-chrome pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_44px_rgba(0,0,0,0.35)]">
            <div className="flex justify-center pb-1 pt-3">
              <span className="h-1 w-10 rounded-full bg-edge" />
            </div>
            <p className="px-5 pb-2 pt-1 text-[9px] uppercase tracking-[0.2em] text-muted">
              All sections
            </p>
            <div className="pb-4">
              {groups.map((group) => (
                <div key={group.id}>
                  <p className="px-5 pb-1 pt-3 text-[9px] uppercase tracking-[0.2em] text-muted">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-3 gap-2 px-4 pb-1 sm:grid-cols-4">
                    {group.children.map(({ to, label, icon: Icon, end }) => (
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
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-4 bottom-4 z-50 rounded-[26px] border glass-chrome lg:hidden">
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
          {groups.length > 0 && (
            <Button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-label="More sections"
              aria-expanded={more}
              variant="nav"
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
            </Button>
          )}
        </div>
      </nav>
    </>
  );
}
