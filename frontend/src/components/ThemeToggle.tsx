import { useEffect, useState } from 'react';
import { Moon, Palette, Sparkles, Sun } from 'lucide-react';
import {
  applyTheme,
  getThemeMode,
  onThemeChanged,
  setThemeMode,
  watchSystemTheme,
  type ThemeMode,
} from '@/lib/theme';
import { Button } from '@/components/Button';

interface ThemeInfo {
  label: string;
  next: ThemeMode;
  nextLabel: string;
  icon: typeof Sun;
}

const THEME_CYCLE: Record<ThemeMode, ThemeInfo> = {
  light: {
    label: 'Light',
    next: 'dark',
    nextLabel: 'Dark',
    icon: Sun,
  },
  dark: {
    label: 'Dark',
    next: 'system',
    nextLabel: 'Auto',
    icon: Moon,
  },
  system: {
    label: 'Auto',
    next: 'light',
    nextLabel: 'Light',
    icon: Sparkles,
  },
  ledgerly: {
    label: 'Ledgerly',
    next: 'light',
    nextLabel: 'Light',
    icon: Palette,
  },
  'ledgerly-light': {
    label: 'Ledgerly Light',
    next: 'light',
    nextLabel: 'Light',
    icon: Sparkles,
  },
};

/**
 * Header theme control (#169).
 * One-click theme switcher cycling Light -> Dark -> Auto.
 * Settings retains the full ThemeManager modal for browsing all themes.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());

  useEffect(() => {
    applyTheme(mode);
    watchSystemTheme();
    // Server hydration (login / me) can change the theme from elsewhere —
    // keep the icon/state in sync instead of showing a stale mode.
    return onThemeChanged(() => setMode(getThemeMode()));
  }, [mode]);

  const info = THEME_CYCLE[mode] ?? THEME_CYCLE.system;
  const Icon = info.icon;

  const handleClick = () => {
    const current = getThemeMode();
    const nextMode = THEME_CYCLE[current]?.next ?? 'light';
    setThemeMode(nextMode);
    setMode(nextMode);
  };

  const labelText = `Theme: ${info.label} - click for ${info.nextLabel}`;

  return (
    <Button
      type="button"
      aria-label={labelText}
      title={labelText}
      onClick={handleClick}
      variant="secondary"
      size="icon"
      className={className}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
