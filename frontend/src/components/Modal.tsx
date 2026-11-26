import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/Button';
import { LiquidGlassSurface } from '@/components/LiquidGlass';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Stacking order (FE-01) — defaults to the classic 60; confirms nested over the z-70 drawer pass 80. */
  zIndex?: number;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog on sm+; bottom sheet <sm (grab handle, 92dvh, scrollable body).
 * PORTALED to document.body: the route wrapper's (filled) entrance animation
 * creates a stacking context that would cap this z-[60] below the z-50 bottom
 * nav (real bug: submit buttons behind the nav on mobile).
 */
export default function Modal({ title, onClose, children, zIndex = 60 }: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // FE-02: capture-phase + stopPropagation — with a drawer underneath, this
  // topmost Escape wins and the lower layer never sees the key (Escape used
  // to close both). The listbox guard stays: an open Select/Canned menu owns
  // keyboard handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="listbox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // Focus trap + restore. The listbox guard mirrors the Escape handler: while
  // a Select menu is open it owns keyboard handling, so the trap stands down.
  // Capture-phase (FE-02): the topmost layer routes Tab first, and lower
  // layers (drawer) stand down while [data-modal] is present — nested
  // drawer+modal traps used to deadlock Tab between them.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!document.querySelector('[role="listbox"]')) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? container.querySelector<HTMLElement>('[role="dialog"]'))?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (document.querySelector('[role="listbox"]')) return;
      const scope = containerRef.current;
      if (!scope) return;
      const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !scope.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !scope.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus();
    };
  }, []);
  return createPortal(
    // data-modal lets lower layers (drawer trap/Escape) stand down while a
    // Modal is open (FE-02). Inline zIndex carries the prop (default 60, the
    // unchanged classic); the class stays as the no-prop fallback.
    <div ref={containerRef} data-modal="true" style={{ zIndex }} className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <LiquidGlassSurface
        variant="chrome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="animate-sheet-up modal-panel relative flex max-h-[92dvh] w-full flex-col rounded-t-[26px] liquid-glass-panel sm:max-w-lg sm:rounded-[26px]"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-elevated2 sm:hidden" />
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 id="modal-title" className="text-sm font-semibold text-primary">{title}</h2>
          <Button
            type="button"
            onClick={onClose}
            aria-label="Close"
            variant="ghost"
            size="icon"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] [overscroll-behavior:contain]">
          {children}
        </div>
      </LiquidGlassSurface>
    </div>,
    document.body,
  );
}
