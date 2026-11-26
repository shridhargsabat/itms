import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn, inputCls } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  /** Forwarded to the trigger button so a <label htmlFor> can target it. */
  id?: string;
  /** Classes for the trigger BUTTON (size/typography overrides). The outer
   *  wrapper is styled by `className`; the trigger is otherwise fixed by
   *  inputCls + py-2.5, which is too tall for compact controls (e.g. the
   *  DataTable pagination footer). */
  triggerClassName?: string;
  /** Accessible name for the trigger button (TFE-33/C3). Applied as aria-label. */
  ariaLabel?: string;
  /** Accessible label forwarded to the trigger button (e.g. "Rows per page"). Alias of ariaLabel. */
  'aria-label'?: string;
  /** When true, renders a filter input at the top of the menu that filters
   *  options by label (case-insensitive substring). The keyboard model is
   *  unchanged — arrows/Home/End/Enter/Escape/Tab operate on the filtered
   *  list. Default false. */
  searchable?: boolean;
}

/**
 * App-native dropdown (no native <select>). The menu is rendered with
 * `position: fixed` so it escapes scroll containers (modal sheets, tables).
 * Closes on: outside click, Escape, scroll, resize.
 *
 * Keyboard model (FE-08): the portaled menu is OUT of the tab order
 * (options are tabIndex -1) but fully keyboard-operable — focus moves into
 * the menu on open, ArrowUp/Down/Home/End move the active option (exposed
 * via aria-activedescendant), Enter/Space selects, Tab closes and resumes
 * the natural tab order from the trigger, Escape closes returning focus to
 * the trigger.
 *
 * When `searchable` is set, a filter input renders at the top of the menu
 * (focused on open so typing starts immediately). It filters options by
 * label; navigation keys bubble from the input to the same menu handler, so
 * the keyboard model above operates on the filtered list unchanged — except
 * Space, which types filter text instead of selecting.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  id,
  triggerClassName,
  ariaLabel,
  'aria-label': ariaLabelAttr,
  searchable = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; left: number; width: number; maxWidth: number } | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const menuHeight = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;

  // UX-04: the searchable filter narrows by label (case-insensitive
  // substring). Everything below — keyboard nav, aria-activedescendant,
  // choose() — operates on `visible`, never the full list.
  const needle = query.trim().toLowerCase();
  const visible = searchable && needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  const selectedIndex = visible.findIndex((o) => o.value === value);
  // Guard against the option list shrinking while the menu is open.
  const safeActive = visible.length === 0 ? 0 : Math.min(Math.max(active, 0), visible.length - 1);

  const close = () => {
    setOpen(false);
    setMenu(null);
    setQuery('');
  };

  const closeReturnFocus = () => {
    // Return focus to the trigger only when it was inside the menu (or
    // already on the trigger): if focus moved elsewhere — e.g. a drawer
    // control tabbed past the open menu — Escape/choose must not yank it
    // back (FE-03/TFE-32 traps keep working on the real focused element).
    const activeEl = document.activeElement;
    const reclaim =
      activeEl != null &&
      (activeEl === triggerRef.current || (menuRef.current?.contains(activeEl) ?? false));
    close();
    if (reclaim) triggerRef.current?.focus();
  };

  const openMenu = (initialActive?: number) => {
    setQuery('');
    setActive(initialActive ?? (selectedIndex >= 0 ? selectedIndex : 0));
    setOpen(true);
  };

  const choose = (index: number) => {
    const o = visible[index];
    if (!o) return;
    onChange(o.value);
    closeReturnFocus();
  };

  /** Keep the keyboard-active option visible inside the scrollable menu. */
  const reveal = (index: number) => {
    document.getElementById(optId(index))?.scrollIntoView?.({ block: 'nearest' });
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!visible.length) return;
        const next = Math.min(safeActive + 1, visible.length - 1);
        setActive(next);
        reveal(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (!visible.length) return;
        const next = Math.max(safeActive - 1, 0);
        setActive(next);
        reveal(next);
        break;
      }
      case 'Home': {
        e.preventDefault();
        if (!visible.length) return;
        setActive(0);
        reveal(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        if (!visible.length) return;
        setActive(visible.length - 1);
        reveal(visible.length - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        // UX-04: a Space typed in the filter input is filter text, not "select".
        if (e.key === ' ' && (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
        e.preventDefault();
        choose(safeActive);
        break;
      }
      case 'Escape':
        // Normally intercepted by the window capture listener below (which
        // also swallows the event so parent dialogs stay open); this is the
        // fallback for events that never travel through window.
        e.preventDefault();
        e.stopPropagation();
        closeReturnFocus();
        break;
      case 'Tab':
        // Resume the natural tab order from the trigger: focus it now (the
        // menu unmounts) and let the default Tab advance past it.
        closeReturnFocus();
        break;
    }
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    // (Enter/Space on the trigger natively fire click → toggle → open.)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ref.current?.scrollIntoView({ block: 'nearest' });
      openMenu(e.key === 'ArrowDown' ? (selectedIndex >= 0 ? selectedIndex : 0) : Math.max(visible.length - 1, 0));
    }
  };

  const placeMenu = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mh = menuHeight.current || 224;
    const spaceBelow = window.innerHeight - r.bottom;
    // Cap: never wider than 340px nor wider than the viewport (minus a
    // small margin). The menu grows to fit its longest option up to this.
    const cappedW = Math.min(340, window.innerWidth - 16);
    const actualW = Math.min(
      cappedW,
      Math.max(r.width, menuRef.current?.offsetWidth || r.width),
    );
    const clampedLeft = Math.max(8, Math.min(r.left, window.innerWidth - actualW - 8));
    setMenu({
      // Flip upward only when the menu wouldn't fit below; exact height
      // (measured, not guessed) so there's never a floating gap.
      top: spaceBelow >= mh + 12 ? r.bottom + 6 : Math.max(8, r.top - mh - 6),
      left: clampedLeft,
      width: r.width,
      maxWidth: cappedW,
    });
  };

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        placeMenu();
      });
    };
    const onDown = (e: MouseEvent) => {
      // Ignore mousedowns inside the trigger OR the portaled menu —
      // otherwise the click that selects an option never lands (the menu
      // unmounts between mousedown and click).
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeReturnFocus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    // Follow the trigger while the page scrolls instead of closing
    // (mobile users scroll under an open dropdown all the time).
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // Measure + place SYNCHRONOUSLY after the menu is committed to the DOM.
  // (A rAF here races React's commit — the menu ref can still be null when
  // it fires, the height silently falls back to the 224px guess, and a
  // flipped menu lands ~70px above its trigger: "the dropdown shows at the
  // field above". useLayoutEffect runs after the commit, before paint, so
  // the measurement is always real and the placement is exact.)
  // FE-08: also move focus into the portaled menu (it lives at the end of
  // <body>, outside the natural tab order) so arrows/Enter work immediately.
  useLayoutEffect(() => {
    if (!open) return;
    if (menuRef.current) menuHeight.current = menuRef.current.offsetHeight;
    placeMenu();
    // UX-04: searchable menus focus the filter so typing starts immediately;
    // navigation keys bubble from the input to the menu handler unchanged.
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    else menuRef.current?.focus({ preventScroll: true });
  }, [open]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    openMenu();
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabelAttr ?? ariaLabel}
        className={cn(inputCls, 'flex items-center justify-between gap-2 py-2.5 text-left', triggerClassName)}
      >
        <span className={cn('truncate', selected ? 'text-primary' : 'text-muted')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            style={{
              position: 'fixed',
              // Provisional 0,0 while the layout effect measures + places
              // (before first paint — never visible).
              top: menu?.top ?? 0,
              left: menu?.left ?? 0,
              // Menu is at least as wide as the trigger, grows to fit its
              // longest option (max-content), capped so it never overflows
              // the viewport on narrow screens.
              minWidth: menu?.width ?? 0,
              width: 'max-content',
              maxWidth: menu?.maxWidth ?? 0,
            }}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={visible.length ? optId(safeActive) : undefined}
            onKeyDown={onMenuKeyDown}
            className="animate-menu-in z-[70] max-h-64 overflow-auto rounded-lg border border-edge bg-surface p-1 shadow-xl outline-none"
          >
            {searchable && (
              <div className="sticky -top-1 bg-surface pb-1 pt-1">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Filter options"
                  aria-label="Filter options"
                  className={cn(inputCls, 'py-1.5')}
                />
              </div>
            )}
            {visible.length === 0 && searchable && needle ? (
              <p className="px-3 py-2 text-sm text-muted">No matching options</p>
            ) : (
              visible.map((o, i) => {
              const highlighted = i === safeActive;
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  id={optId(i)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 overflow-hidden whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors',
                    highlighted || isSelected
                      ? 'bg-elevated2/70 text-primary'
                      : 'text-secondary hover:bg-elevated2/40 hover:text-primary',
                  )}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
              }))
            }
          </div>,
          document.body,
        )}
    </div>
  );
}
