import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Canonical button geometry — the ONE spec every ITMS action button renders
 * with, mirroring TABLE_SPEC / inputCls / labelCls. Recipes reference ONLY
 * semantic tokens (--t-accent etc.) so they theme correctly across light,
 * dark and ledgerly-dark. Colour fills use bg-accent (adapts to the active
 * theme); `danger` deliberately stays a fixed red stop-colour (works in all
 * themes). Never add fixed indigo/blue/gradients here — that's the theming
 * bug this component exists to prevent.
 */
export const BUTTON = {
  /* shared base: aligned flex row, rounded, focus ring, disabled rules */
  base:
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium ' +
    'transition-colors disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ' +
    'select-none whitespace-nowrap',

  /* variants */
  primary: 'bg-accent text-on-accent hover:bg-accent/90 shadow-[inset_0_1px_0_var(--t-glass-hi)]',
  secondary: 'glass-dense text-secondary hover:bg-elevated hover:text-primary',
  ghost: 'text-secondary hover:bg-elevated hover:text-primary',
  danger: 'bg-red-500 text-white hover:bg-red-600',
  text: 'text-accent hover:underline',
  /* nav cell — used by BottomNav / Layout tab-like anchors (kept as anchors) */
  nav: 'flex items-center justify-center gap-1.5 transition-colors',

  /* sizes */
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-4 text-sm',
  icon: 'h-9 w-9',
} as const;

export type ButtonVariant = keyof Pick<typeof BUTTON, 'primary' | 'secondary' | 'ghost' | 'danger' | 'text' | 'nav'>;
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render a square icon-only button (h-9 w-9). Use with size="icon". */
  iconOnly?: boolean;
  /** Show a spinner, set aria-busy, and force disabled. */
  loading?: boolean;
  /** w-full (for full-width CTAs). */
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * Shared ITMS Button primitive. Renders a native <button> (type="button" by
 * default — never an accidental submit). Pass any native button prop through;
 * `className` merges on top of the variant/size recipe via twMerge.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    iconOnly = false,
    loading = false,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const recipe = cn(
    BUTTON.base,
    BUTTON[variant],
    size === 'icon' || iconOnly ? BUTTON.icon : BUTTON[size],
    fullWidth && 'w-full',
    (iconOnly || (size === 'icon' && !children)) && 'p-0',
    className,
  );

  return (
    <button
      ref={ref}
      type={type}
      className={recipe}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
