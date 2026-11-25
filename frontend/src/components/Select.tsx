import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
}

/**
 * App-native dropdown (no native <select>). The menu is rendered with
 * `position: fixed` so it escapes scroll containers (modal sheets, tables).
 * Closes on: outside click, Escape, scroll, resize.
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
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; left: number; width: number; maxWidth: number } | null>(null);
  const menuHeight = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setMenu(null);
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
        close();
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
  useLayoutEffect(() => {
    if (!open) return;
    if (menuRef.current) menuHeight.current = menuRef.current.offsetHeight;
    placeMenu();
  }, [open]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    setOpen(true);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
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
            className="animate-menu-in z-[70] max-h-64 overflow-auto rounded-lg border border-edge bg-surface p-1 shadow-xl"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 overflow-hidden whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors',
                  o.value === value
                    ? 'bg-elevated2/70 text-primary'
                    : 'text-secondary hover:bg-elevated2/40 hover:text-primary',
                )}
              >
                <span className="min-w-0 truncate">{o.label}</span>
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
