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

/**
 * Manual service-worker lifecycle handling (the plugin's injected registerSW.js
 * is bare — no update wiring). Dispatches `itms:update` when a newer build is
 * installed/activated so the UpdateToast can surface it.
 */
export function initSwUpdateHandling() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        const check = () => reg.update().catch(() => {});
        check();
        const interval = window.setInterval(check, 60_000); // check every minute
        window.addEventListener('beforeunload', () => window.clearInterval(interval));

        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('itms:update', { detail: { phase: 'installed' } }));
            }
          });
        });
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.dispatchEvent(new CustomEvent('itms:update', { detail: { phase: 'activated' } }));
    });
  });
}

/** Surfaces the update event: true + reload callback when a newer build is ready. */
export function useUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('itms:update' as keyof WindowEventMap, onUpdate as EventListener);
    return () => window.removeEventListener('itms:update' as keyof WindowEventMap, onUpdate as EventListener);
  }, []);

  const reload = () => {
    setUpdateAvailable(false);
    window.location.reload();
  };

  return { updateAvailable, reload };
}
