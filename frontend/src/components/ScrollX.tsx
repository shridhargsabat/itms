import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScrollXProps {
  children: ReactNode;
  className?: string;
  /** Class for the scrolling element itself. */
  innerClassName?: string;
}

/**
 * Horizontally scrollable container with a right-edge fade affordance.
 * The fade appears only when content actually overflows (ResizeObserver),
 * so wide tables/boards signal "swipe for more" without permanent decoration.
 */
export default function ScrollX({ children, className, innerClassName }: ScrollXProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCanScroll(el.scrollWidth > el.clientWidth + 4);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn('relative', className)}>
      <div ref={ref} className={cn('overflow-x-auto', innerClassName)}>
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-edge/80 to-transparent transition-opacity duration-200',
          canScroll ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
