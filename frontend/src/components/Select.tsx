import { useEffect, useRef, useState } from 'react';
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
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setMenu(null);
  };

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - r.bottom;
        setMenu({
          top: spaceBelow > 280 ? r.bottom + 6 : Math.max(8, r.top - 280),
          left: r.left,
          width: r.width,
        });
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
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Follow the trigger while the page scrolls instead of closing
    // (mobile users scroll under an open dropdown all the time).
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const r = ref.current!.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    setMenu({
      top: spaceBelow > 280 ? r.bottom + 6 : Math.max(8, r.top - 280),
      left: r.left,
      width: r.width,
    });
    setOpen(true);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(inputCls, 'flex items-center justify-between gap-2 py-2.5 text-left')}
      >
        <span className={cn('truncate', selected ? 'text-slate-100' : 'text-slate-500')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && menu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menu.top, left: menu.left, width: menu.width }}
            role="listbox"
            className="animate-menu-in z-[70] max-h-64 overflow-auto rounded-lg border border-slate-700 bg-slate-800/95 p-1 shadow-2xl backdrop-blur"
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
                  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  o.value === value
                    ? 'bg-slate-700/70 text-white'
                    : 'text-slate-300 hover:bg-slate-700/40 hover:text-white',
                )}
              >
                {o.label}
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
