import { useEffect, useState } from 'react';
import { applyTheme, getThemeMode, onThemeChanged, watchSystemTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import ThemeManager, { THEMES } from '@/components/ThemeManager';
import { Button } from '@/components/Button';

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
      <Button
        type="button"
        aria-label="Theme manager"
        title={`Theme: ${meta.label} (open manager)`}
        onClick={() => setManagerOpen(true)}
        variant="secondary"
        size="icon"
        className={cn('border-edge bg-elevated/60', className)}
      >
        <Icon className="h-4 w-4" />
      </Button>
      <ThemeManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}