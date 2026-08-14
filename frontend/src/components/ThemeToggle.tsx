import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, getThemeMode, setThemeMode, watchSystemTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };

/** Cycles light → dark → system. Resolves 'system' live (device setting). */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());

  useEffect(() => {
    applyTheme(mode);
    watchSystemTheme();
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
