import { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  Moon,
  Palette,
  Shell,
  Sparkles,
  SquareTerminal,
  Sun,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  applyTheme,
  getThemeMode,
  onThemeChanged,
  setThemeMode,
  watchSystemTheme,
  type ThemeMode,
} from '@/lib/theme';
import { THEME_REGISTRY, type ThemeMeta as RegistryMeta } from '@/lib/theme-registry';
import { Button } from '@/components/Button';
import { cn } from '@/lib/utils';

const MODE_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Sparkles,
  'ledgerly-light': Sparkles,
  ledgerly: Palette,
  paper: FileText,
  console: Terminal,
  bold: Zap,
  shell: Shell,
  terminal: SquareTerminal,
};

const GROUPS: Array<{ heading: 'New' | 'Classic'; modes: RegistryMeta[] }> = [
  { heading: 'New', modes: Object.values(THEME_REGISTRY).filter((m) => m.group === 'new') },
  { heading: 'Classic', modes: Object.values(THEME_REGISTRY).filter((m) => m.group === 'classic') },
];

/**
 * Header/footer theme control (#169, #179, #185).
 * Accessible 10-option dropdown listing every THEME_REGISTRY mode grouped
 * New/Classic. Selecting applies immediately (local fast path + server push
 * via setThemeMode — these are logged-in surfaces).
 * showLabel renders the current mode name (wide sidebar footer); icon-only
 * everywhere else (header, collapsed rail).
 */
export default function ThemeToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(mode);
    watchSystemTheme();
    // Server hydration (login / me) can change the theme from elsewhere —
    // keep the icon/state in sync instead of showing a stale mode.
    return onThemeChanged(() => setMode(getThemeMode()));
  }, [mode]);

  // Click-outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open ]);

  const info = THEME_REGISTRY[mode] ?? THEME_REGISTRY.system;
  const Icon = MODE_ICONS[mode] ?? Sun;

  const choose = (value: ThemeMode) => {
    setThemeMode(value);
    setMode(value);
    setOpen(false);
  };

  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  const labelText = `Theme: ${info.label}`;

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        aria-label={labelText}
        title={labelText}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={closeOnEscape}
        variant="secondary"
        size="icon"
        className={className}
      >
        <Icon className={showLabel ? 'h-5 w-5 shrink-0' : 'h-4 w-4'} />
        {showLabel && <span className="truncate">{info.label}</span>}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Theme"
          onKeyDown={closeOnEscape}
          className="absolute right-0 top-full z-50 mt-2 max-h-96 w-60 overflow-auto rounded-xl border border-edge bg-surface p-1.5 shadow-xl"
        >
          {GROUPS.map((g) => (
            <div key={g.heading}>
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.heading}
              </p>
              {g.modes.map((m) => {
                const checked = m.value === mode;
                const ItemIcon = MODE_ICONS[m.value];
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => choose(m.value)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      checked ? 'bg-accent/10 text-primary' : 'text-secondary hover:bg-elevated hover:text-primary',
                    )}
                  >
                    <ItemIcon className={cn('h-4 w-4 shrink-0', checked ? 'text-accent' : 'text-muted')} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {checked && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
