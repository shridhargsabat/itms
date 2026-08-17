import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, getResolvedTheme, getThemeMode, setThemeMode, watchSystemTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const MODE_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };
// Icon reflects the RESOLVED theme (sun/moon), not the mode — system mode
// shows the actual OS theme so the button reads as a theme control.
function useResolvedTheme(): 'light' | 'dark' {
  const [resolved, setResolved] = useState<'light' | 'dark'>(getResolvedTheme());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyTheme();                      // keep .dark in sync when OS flips while in system mode
      setResolved(getResolvedTheme());   // re-render icon
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return resolved;
}

export default function ThemeToggle({ className, segmented = false }: {
  className?: string; segmented?: boolean;
}) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const resolved = useResolvedTheme();

  useEffect(() => { applyTheme(mode); watchSystemTheme(); }, [mode]);

  if (segmented) {
    const modes: ThemeMode[] = ['light', 'system', 'dark'];
    const icons = { light: Sun, system: Monitor, dark: Moon };
    return (
      <div role="group" aria-label="Theme" className={cn('flex items-center gap-1', className)}>
        {modes.map((m) => {
          const Icon = icons[m];
          const active = mode === m;
          return (
            <button
              key={m} type="button"
              aria-pressed={active}
              title={`${MODE_LABEL[m]} theme`}
              onClick={() => { setThemeMode(m); setMode(m); }}
              className={cn(
                'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors',
                active
                  ? 'border-edge2 bg-elevated text-primary'
                  : 'border-transparent text-muted hover:bg-elevated/60 hover:text-primary',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {MODE_LABEL[m]}
            </button>
          );
        })}
      </div>
    );
  }

  const Icon = resolved === 'dark' ? Moon : Sun;
  const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
  return (
    <button
      type="button"
      aria-label={`Theme: ${MODE_LABEL[mode]} (click to switch)`}
      title={`Theme: ${MODE_LABEL[mode]} — click to switch`}
      onClick={() => { const next = NEXT[mode]; setThemeMode(next); setMode(next); }}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-elevated/60 text-secondary transition-colors hover:text-primary',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
