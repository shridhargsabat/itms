import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';
import { visibleNavGroups, type NavChild, type NavGroup } from '@/lib/nav';
import type { AuthUser } from '@/api/types';

const STORAGE_KEY = 'itms_nav_expanded';

/** Mirrors NavLink active semantics (exact for `end`, prefix otherwise). */
function isChildActive(child: NavChild, pathname: string): boolean {
  if (child.end) return pathname === child.to;
  return pathname === child.to || pathname.startsWith(child.to + '/');
}

function loadExpanded(): string[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

interface SidebarNavProps {
  /** Wide (labels) vs collapsed rail (icons only) rendering. */
  wide: boolean;
  user: Pick<AuthUser, 'role'> | null;
  /** Expand a user-collapsed rail (rail parent click). */
  onExpandSidebar: () => void;
}

/**
 * Grouped sidebar navigation tree (see NAV_GROUPS in lib/nav.ts).
 * Single-child groups (Dashboard) render as flat rows; parents render an
 * expander header + indented child rows. Expanded state persists in
 * localStorage; the group containing the active route auto-expands on
 * navigation (merged into — never wiping — the stored state).
 */
export default function SidebarNav({ wide, user, onExpandSidebar }: SidebarNavProps) {
  const { pathname } = useLocation();
  const groups: NavGroup[] = visibleNavGroups(user);
  // Default: everything open (discoverable); user collapses persist.
  const [expanded, setExpanded] = useState<string[]>(
    () => loadExpanded() ?? NAV_ALL_IDS(groups),
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      /* private-mode: state just won't persist */
    }
  }, [expanded]);

  // Deep link / route change: the active group must be open so the active
  // child is visible. Merge-only — the user's other groups are untouched.
  useEffect(() => {
    const active = groups.find((g) => !g.single && g.children.some((c) => isChildActive(c, pathname)));
    if (active) {
      setExpanded((prev) => (prev.includes(active.id) ? prev : [...prev, active.id]));
    }
    // groups identity changes per render; pathname is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = (id: string) => {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const rowBase =
    'flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors';
  const leafCls = (isActive: boolean, extra = '') =>
    cn(
      rowBase,
      wide ? '' : 'justify-center px-0',
      isActive
        ? 'bg-elevated text-primary'
        : 'text-secondary hover:bg-elevated/60 hover:text-primary',
      extra,
    );

  return (
    <>
      {groups.map((group) => {
        // Standalone entries render exactly like the old flat rows.
        if (group.single) {
          const child = group.children[0];
          const Icon = child.icon;
          return (
            <NavLink
              key={group.id}
              to={child.to}
              end={child.end}
              title={!wide ? child.label : undefined}
              className={({ isActive }) => leafCls(isActive)}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {wide && <span className="truncate">{child.label}</span>}
            </NavLink>
          );
        }

        const GroupIcon = group.icon;
        const open = expanded.includes(group.id);
        const activeGroup = group.children.some((c) => isChildActive(c, pathname));

        // Collapsed rail: one icon cell per parent; same active treatment as
        // leaf rows when it contains the active route. Clicking expands the
        // sidebar AND the group (parents are not routes — nothing to navigate to).
        if (!wide) {
          return (
            <Button
              key={group.id}
              type="button"
              variant="ghost"
              size="icon"
              title={group.label}
              aria-label={`Expand ${group.label} section`}
              onClick={() => {
                onExpandSidebar();
                setExpanded((prev) => (prev.includes(group.id) ? prev : [...prev, group.id]));
              }}
              className={cn('w-full', activeGroup && 'bg-elevated text-primary')}
            >
              <GroupIcon className="h-5 w-5 shrink-0" />
            </Button>
          );
        }

        return (
          <div key={group.id}>
            <Button
              type="button"
              variant="ghost"
              aria-expanded={open}
              aria-controls={`navgroup-${group.id}`}
              onClick={() => toggle(group.id)}
              className="h-auto w-full justify-start gap-3 rounded-full px-3 py-2.5 text-sm font-medium hover:bg-elevated/60"
              rightIcon={
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 transition-transform',
                    open && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              }
            >
              <GroupIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">{group.label}</span>
            </Button>
            {open && (
              <div id={`navgroup-${group.id}`} className="mt-0.5 space-y-0.5">
                {group.children.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      end={child.end}
                      className={({ isActive }) => leafCls(isActive, 'pl-11')}
                    >
                      <ChildIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{child.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function NAV_ALL_IDS(groups: NavGroup[]): string[] {
  return groups.map((g) => g.id);
}
