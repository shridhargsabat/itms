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
import { getThemeMode, markLoginThemeChoice, onThemeChanged, setThemeModeLocal, type ThemeMode } from '@/lib/theme';
import { THEME_REGISTRY, type ThemeMeta as RegistryMeta } from '@/lib/theme-registry';
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
  clarity: Sun,
  'clarity-dark': Moon,
};

const GROUPS: Array<{ heading: 'New' | 'Classic'; modes: RegistryMeta[] }> = [
  { heading: 'New', modes: Object.values(THEME_REGISTRY).filter((m) => m.group === 'new') },
  { heading: 'Classic', modes: Object.values(THEME_REGISTRY).filter((m) => m.group === 'classic') },
];

/**
 * Pre-auth theme menu for /login.
 * Tiny fixed-corner chip so visitors can browse all 12 skins without
 * logging in. Mirrors the accessible dropdown pattern in ThemeToggle,
 * but applies via setThemeModeLocal ONLY — never any network call
 * pre-auth. Styling is theme-agnostic (fixed dark chip) so it stays
 * readable on every skin, including the light ones.
 */
export default function LoginThemeMenu() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Stay in sync if the theme changes from elsewhere.
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);

  // Click-outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const info = THEME_REGISTRY[mode] ?? THEME_REGISTRY.paper;

  const choose = (value: ThemeMode) => {
    setThemeModeLocal(value);
    // Task 16: an explicit pre-auth pick must survive login (syncThemeAfterLogin
    // consumes this once and pushes the choice up instead of hydrating over it).
    markLoginThemeChoice();
    setMode(value);
    setOpen(false);
  };

  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  const labelText = `Login theme: ${info.label}`;

  return (
    <div ref={rootRef}>
      <button
        type="button"
        aria-label={labelText}
        title={labelText}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={closeOnEscape}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-lg"
      >
        <Palette className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-36 truncate">{info.label}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Login theme"
          onKeyDown={closeOnEscape}
          className="fixed bottom-16 right-4 z-50 max-h-80 w-52 overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1 pb-2 shadow-xl"
        >
          {GROUPS.map((g) => (
            <div key={g.heading}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                      checked ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
                    )}
                  >
                    <ItemIcon className={cn('h-3.5 w-3.5 shrink-0', checked ? 'text-white' : 'text-zinc-500')} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {checked && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
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
