import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/Button';
import { LiquidGlassSurface } from '@/components/LiquidGlass';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog on sm+; bottom sheet <sm (grab handle, 92dvh, scrollable body).
 * PORTALED to document.body: the route wrapper's (filled) entrance animation
 * creates a stacking context that would cap this z-[60] below the z-50 bottom
 * nav (real bug: submit buttons behind the nav on mobile).
 */
export default function Modal({ title, onClose, children }: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented || document.querySelector('[role="listbox"]')) return;
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Focus trap + restore. The listbox guard mirrors the Escape handler: while
  // a Select menu is open it owns keyboard handling, so the trap stands down.
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
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, []);
  return createPortal(
    <div ref={containerRef} className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <LiquidGlassSurface
        variant="chrome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="animate-sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-[26px] liquid-glass-panel sm:max-w-lg sm:rounded-[26px]"
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
