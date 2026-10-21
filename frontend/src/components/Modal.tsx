import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/Button';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Centered dialog on sm+; bottom sheet <sm (grab handle, 92dvh, scrollable body).
 * PORTALED to document.body: the route wrapper's (filled) entrance animation
 * creates a stacking context that would cap this z-[60] below the z-50 bottom
 * nav (real bug: submit buttons behind the nav on mobile).
 */
export default function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl glass-chrome sm:max-w-lg sm:rounded-xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-elevated2 sm:hidden" />
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
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
      </div>
    </div>,
    document.body,
  );
}
