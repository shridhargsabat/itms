import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Call once at app boot: captures the browser's install prompt for later use. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

/** True while the browser considers the app installable (prompt captured, not yet installed). */
export function usePwaInstallable() {
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    const sync = () => setInstallable(deferredPrompt !== null);
    sync();
    window.addEventListener('beforeinstallprompt', sync);
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      sync();
    });
    return () => {
      window.removeEventListener('beforeinstallprompt', sync);
      window.removeEventListener('appinstalled', sync);
    };
  }, []);

  return { installable, promptInstall: () => deferredPrompt?.prompt() };
}

/** Surfaces the vite-plugin-pwa update event: returns true + reload callback when a new SW waits. */
export function useUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ updateSW: () => Promise<void> }>).detail;
      if (detail?.updateSW) {
        setUpdateAvailable(true);
        // Persist the reload trigger on window so the toast can invoke it
        (window as unknown as { __itms_updateSW?: () => Promise<void> }).__itms_updateSW =
          detail.updateSW;
      }
    };
    window.addEventListener('sw-updated' as keyof WindowEventMap, onUpdate as EventListener);
    return () => window.removeEventListener('sw-updated' as keyof WindowEventMap, onUpdate as EventListener);
  }, []);

  const reload = async () => {
    const fn = (window as unknown as { __itms_updateSW?: () => Promise<void> }).__itms_updateSW;
    if (fn) await fn();
    window.location.reload();
  };

  return { updateAvailable, reload };
}
