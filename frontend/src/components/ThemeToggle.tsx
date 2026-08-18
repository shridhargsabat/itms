import { useEffect, useState } from 'react';
import { applyTheme, getThemeMode, onThemeChanged, watchSystemTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import ThemeManager, { THEMES } from '@/components/ThemeManager';

/**
 * Header theme control. Clicking opens the theme manager (live previews,
 * apply button) instead of blind cycling — the user asked for a manager
 * where they can see the palette before applying.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    applyTheme(mode);
    watchSystemTheme();
    // Server hydration (login / me) can change the theme from elsewhere —
    // keep the icon/state in sync instead of showing a stale mode.
    return onThemeChanged(() => setMode(getThemeMode()));
  }, [mode]);

  const meta = THEMES.find((t) => t.value === mode) ?? THEMES[3];
  const Icon = meta.icon;

  return (
    <>
      <button
        type="button"
        aria-label="Theme manager"
        title={`Theme: ${meta.label} (open manager)`}
        onClick={() => setManagerOpen(true)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-elevated/60 text-secondary transition-colors hover:text-primary',
          className,
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
      <ThemeManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}