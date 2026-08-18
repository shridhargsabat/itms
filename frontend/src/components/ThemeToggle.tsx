import { useEffect, useState } from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { applyTheme, getThemeMode, onThemeChanged, setThemeMode, watchSystemTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, ledgerly: Palette, system: Monitor };
const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'ledgerly', ledgerly: 'system', system: 'light' };

/** Cycles light → dark → ledgerly → system. Resolves 'system' live (device setting). */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());

  useEffect(() => {
    applyTheme(mode);
    watchSystemTheme();
    // Server hydration (login / me) can change the theme from elsewhere —
    // keep the icon/state in sync instead of showing a stale mode.
    return onThemeChanged(() => setMode(getThemeMode()));
  }, [mode]);

  const Icon = ICONS[mode];
  return (
    <button
      type="button"
      aria-label={`Theme: ${mode} (click to switch)`}
      title={`Theme: ${mode}`}
      onClick={() => {
        const next = NEXT[mode];
        setThemeMode(next);
        setMode(next);
      }}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-elevated/60 text-secondary transition-colors hover:text-primary',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
