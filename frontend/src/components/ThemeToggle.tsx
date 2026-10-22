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
    label: 'Liquid Glass Light',
    next: 'dark',
    nextLabel: 'Liquid Glass Dark',
    icon: Sun,
  },
  dark: {
    label: 'Liquid Glass Dark',
    next: 'system',
    nextLabel: 'Auto',
    icon: Moon,
  },
  system: {
    label: 'Auto',
    next: 'light',
    nextLabel: 'Liquid Glass Light',
    icon: Sparkles,
  },
  ledgerly: {
    label: 'Ledgerly',
    next: 'light',
    nextLabel: 'Liquid Glass Light',
    icon: Palette,
  },
  'ledgerly-light': {
    label: 'Ledgerly Light',
    next: 'light',
    nextLabel: 'Liquid Glass Light',
    icon: Sparkles,
  },
};

/**
 * Header/footer theme control (#169, #179, #185).
 * One-click Liquid Glass switcher cycling Light -> Dark -> Auto.
 * Settings retains the full ThemeManager modal for browsing all themes.
 * showLabel renders the current mode name (wide sidebar footer); icon-only
 * everywhere else (header, collapsed rail).
 */
export default function ThemeToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
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
      <Icon className={showLabel ? 'h-5 w-5 shrink-0' : 'h-4 w-4'} />
      {showLabel && <span className="truncate">{info.label}</span>}
    </Button>
  );
}
