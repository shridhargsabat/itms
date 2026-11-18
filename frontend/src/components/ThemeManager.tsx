import { useEffect, useState } from 'react';
import { Check, FileText, Moon, Palette, Shell, Sparkles, SquareTerminal, Sun, Terminal, Zap } from 'lucide-react';
import Modal from '@/components/Modal';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';
import { getThemeMode, onThemeChanged, setThemeMode, type ThemeMode } from '@/lib/theme';

export interface ThemeMeta {
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
  /** Classes to apply on a wrapper to render the theme (tokens cascade). */
  wrapperClass: string;
  glass: boolean;
}

export const THEMES: ThemeMeta[] = [
  {
    value: 'light',
    label: 'Liquid Glass Light',
    description: 'Apple-style frosted glass, forced light. Bright white surfaces, slate text, indigo accent. The default ITMS look.',
    icon: Sun,
    wrapperClass: 'theme-light',
    glass: true,
  },
  {
    value: 'dark',
    label: 'Liquid Glass Dark',
    description: 'Apple-style frosted glass, forced dark. Slate surfaces, indigo accent (classic ITMS).',
    icon: Moon,
    wrapperClass: 'dark',
    glass: true,
  },
  {
    value: 'system',
    label: 'Liquid Glass (Auto)',
    description: 'Apple-style frosted glass that follows your device (light/dark).',
    icon: Sparkles,
    wrapperClass: 'theme-light',
    glass: true,
  },
  {
    value: 'ledgerly-light',
    label: 'Ledgerly Light',
    description: 'Warm-paper light, deep-teal accent — the elegant Ledgerly look in daylight.',
    icon: Sparkles,
    wrapperClass: 'ledgerly-light',
    glass: false,
  },
  {
    value: 'ledgerly',
    label: 'Ledgerly',
    description: 'Warm-paper dark, teal accent — copied from Ledgerly.',
    icon: Palette,
    wrapperClass: 'dark ledgerly-dark',
    glass: false,
  },
  {
    value: 'paper',
    label: 'Paper',
    description: 'Warm-paper light, ink text — a calm reading-room light theme.',
    icon: FileText,
    wrapperClass: 'theme-paper',
    glass: false,
  },
  {
    value: 'console',
    label: 'Console',
    description: 'Near-black developer dark — a focused terminal feel.',
    icon: Terminal,
    wrapperClass: 'dark theme-console',
    glass: false,
  },
  {
    value: 'bold',
    label: 'Bold',
    description: 'High-contrast neon dark — vivid accent on deep violet-black.',
    icon: Zap,
    wrapperClass: 'dark theme-bold',
    glass: false,
  },
  {
    value: 'shell',
    label: 'Shell',
    description: 'Clean neutral light — crisp white surfaces, minimal chrome.',
    icon: Shell,
    wrapperClass: 'theme-shell',
    glass: false,
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: 'Green-phosphor dark — a retro terminal glow on deep green-black.',
    icon: SquareTerminal,
    wrapperClass: 'dark theme-terminal',
    glass: false,
  },
];

/**
 * Live theme preview: a miniature dashboard rendered inside a wrapper that
 * carries the theme's token classes (`.dark`, `.ledgerly-dark`). Colors are
 * applied via inline `var(--t-*)` styles — they resolve live against the
 * WRAPPER's tokens, so the preview shows the REAL palette. (Tailwind's
 * `bg-surface` &co. go through `--color-*`, which Tailwind v4 resolves at the
 * html root against the CURRENT theme, so token utilities can't be used here.)
 */
function ThemePreview({ theme }: { theme: ThemeMeta }) {
  return (
    <div
      className={cn('rounded-lg border p-2.5', theme.wrapperClass)}
      style={{ borderColor: 'var(--t-edge)', backgroundColor: 'var(--t-base)' }}
    >
      <div
        className="rounded-md border p-2"
        style={
          theme.glass
            ? {
                borderColor: 'var(--t-edge)',
                background: 'color-mix(in srgb, var(--t-surface) 76%, transparent)',
                backdropFilter: 'blur(12px) saturate(150%)',
                WebkitBackdropFilter: 'blur(12px) saturate(150%)',
                boxShadow: 'inset 0 1px 0 var(--t-glass-hi)',
              }
            : {
                borderColor: 'var(--t-edge)',
                backgroundColor: 'var(--t-surface)',
              }
        }
      >
        <div className="flex items-center justify-between">
          <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: 'var(--t-elevated2)' }} />
          <div
            className="grid h-4 w-4 place-items-center rounded"
            style={{ backgroundColor: 'var(--t-accent)', color: '#ffffff' }}
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </div>
        </div>
        <div className="mt-2 h-2 w-3/4 rounded-full" style={{ backgroundColor: 'var(--t-elevated2)' }} />
        <div className="mt-1 h-2 w-1/2 rounded-full" style={{ backgroundColor: 'var(--t-elevated2)' }} />
        <div className="mt-2.5 flex items-center gap-1.5">
          <div className="h-5 flex-1 rounded" style={{ backgroundColor: 'var(--t-accent)' }} />
          <div className="h-5 flex-1 rounded border" style={{ borderColor: 'var(--t-edge2)', backgroundColor: 'var(--t-surface)' }} />
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

  const NEW_ORDER: ThemeMode[] = ['paper', 'console', 'bold', 'shell', 'terminal'];
  const CLASSIC_ORDER: ThemeMode[] = ['light', 'dark', 'system', 'ledgerly-light', 'ledgerly'];
  const sections = [
    { heading: 'New', values: NEW_ORDER },
    { heading: 'Classic', values: CLASSIC_ORDER },
  ];

  const renderCard = (t: ThemeMeta) => {
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
  };

  const byValue = (v: ThemeMode) => THEMES.find((t) => t.value === v)!;

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-xs text-secondary">
        Pick your default theme. Each card previews the real palette — choose one and
        press <span className="font-semibold text-primary">Apply</span>. Your choice saves to
        your account and follows you across devices.
      </p>

      {sections.map((s) => (
        <div key={s.heading} className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{s.heading}</h3>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {s.values.map((v) => renderCard(byValue(v)))}
          </div>
        </div>
      ))}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button
          type="button"
          onClick={onClose}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={apply}
          variant="primary"
        >
          Apply theme
        </Button>
      </div>
    </Modal>
  );
}