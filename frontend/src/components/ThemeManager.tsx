import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import Modal from '@/components/Modal';
import { cn } from '@/lib/utils';
import { getThemeMode, onThemeChanged, setThemeMode, type ThemeMode } from '@/lib/theme';

export interface ThemeMeta {
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
  /** Classes to apply on a wrapper to render the theme (tokens cascade). */
  wrapperClass: string;
}

export const THEMES: ThemeMeta[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright white surfaces, slate text, indigo accent.',
    icon: Sun,
    wrapperClass: 'theme-light',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Slate dark surfaces, indigo accent (classic ITMS).',
    icon: Moon,
    wrapperClass: 'dark',
  },
  {
    value: 'ledgerly',
    label: 'Ledgerly',
    description: 'Warm-paper dark, teal accent — copied from Ledgerly.',
    icon: Palette,
    wrapperClass: 'dark ledgerly-dark',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your device (light when the OS is light, dark otherwise).',
    icon: Monitor,
    wrapperClass: 'theme-light',
  },
];

/**
 * Live theme preview: a miniature dashboard rendered INSIDE a wrapper that
 * carries the theme's token classes (`.dark`, `.ledgerly-dark`). Because every
 * ITMS utility resolves to `var(--t-*)`, the tokens cascade into the mock —
 * so the preview shows the REAL palette, not hardcoded swatches.
 */
function ThemePreview({ theme }: { theme: ThemeMeta }) {
  return (
    <div className={cn('rounded-lg border border-edge/60 p-2.5', theme.wrapperClass)}>
      <div className="rounded-md border border-edge bg-surface p-2">
        <div className="flex items-center justify-between">
          <div className="h-1.5 w-12 rounded-full bg-elevated2" />
          <div className="grid h-4 w-4 place-items-center rounded bg-accent text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </div>
        </div>
        <div className="mt-2 h-2 w-3/4 rounded-full bg-elevated2" />
        <div className="mt-1 h-2 w-1/2 rounded-full bg-elevated2" />
        <div className="mt-2.5 flex items-center gap-1.5">
          <div className="h-5 flex-1 rounded bg-accent" />
          <div className="h-5 flex-1 rounded border border-edge2" />
        </div>
      </div>
    </div>
  );
}

/**
 * Theme manager — pick a theme with a live preview, then apply.
 * Apply persists locally (fast path) and to the user's server pref
 * (cross-device sync via PUT /auth/theme).
 */
export default function ThemeManager({
  open,
  onClose,
  title = 'Theme manager',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
}) {
  const [selected, setSelected] = useState<ThemeMode>(getThemeMode());

  // Stay in sync if the theme changes from elsewhere (server hydration).
  useEffect(() => {
    if (!open) return;
    setSelected(getThemeMode());
    return onThemeChanged(() => setSelected(getThemeMode()));
  }, [open]);

  if (!open) return null;

  const apply = () => {
    setThemeMode(selected);
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-xs text-secondary">
        Pick your default theme. Each card previews the real palette — choose one and
        press <span className="font-semibold text-primary">Apply</span>. Your choice saves to
        your account and follows you across devices.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEMES.map((t) => {
          const active = t.value === selected;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(t.value)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                active
                  ? 'border-accent bg-accent/10 ring-2 ring-accent/60'
                  : 'border-edge bg-base hover:border-edge2',
              )}
            >
              <ThemePreview theme={t} />
              <div className="mt-2 flex items-center gap-2">
                <t.icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-secondary')} />
                <span className="text-sm font-semibold text-primary">{t.label}</span>
                {active && <Check className="ml-auto h-4 w-4 text-accent" />}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">{t.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-edge2 px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated hover:text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
        >
          Apply theme
        </button>
      </div>
    </Modal>
  );
}