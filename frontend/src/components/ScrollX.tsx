import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScrollXProps {
  children: ReactNode;
  className?: string;
  /** Class for the scrolling element itself. */
  innerClassName?: string;
  /** Inline styles forwarded to the scrolling element (e.g. a fill-height max-height). */
  style?: CSSProperties;
  /** Accessible label for the scrollable region (DataTable passes its caption through). */
  'aria-label'?: string;
  /** Alias for `aria-label`. */
  ariaLabel?: string;
}

/**
 * Horizontally scrollable container with a right-edge fade affordance.
 * The fade appears only when content actually overflows (ResizeObserver),
 * so wide tables/boards signal "swipe for more" without permanent decoration.
 * The scroller is a focusable region so keyboard users can scroll it.
 */
export default function ScrollX({
  children,
  className,
  innerClassName,
  style,
  'aria-label': ariaLabelProp,
  ariaLabel: ariaLabelAlias,
}: ScrollXProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const ariaLabel = ariaLabelAlias ?? ariaLabelProp;

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
      <div
        ref={ref}
        style={style}
        role={ariaLabel ? 'region' : undefined}
        tabIndex={ariaLabel ? 0 : undefined}
        aria-label={ariaLabel}
        className={cn('overflow-x-auto', innerClassName)}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 z-[5] w-10 bg-gradient-to-l from-edge/80 to-transparent transition-opacity duration-200',
          canScroll ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
