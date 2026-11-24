/**
 * Global client-error sink (PWA Bug #8, Scanner P-563).
 * Records the last error in sessionStorage (surfaced on the Offline view /
 * diagnostics) and beacons it when VITE_ERROR_BEACON_URL is configured.
 * Chunk-load failures (stale precache after a deploy) trigger a single
 * auto-reload so the fresh SW + bundle take over instead of a white screen.
 *
 * Wave 2-C: the beaconed URL is origin+pathname ONLY. Query strings and
 * hashes can carry reset/SSO secrets (/reset-password?token=…,
 * /oauth/callback?code=…) that must never leave the browser in a beacon.
 */
export function beaconPageUrl(): string {
  try {
    return window.location.origin + window.location.pathname;
  } catch {
    return '';
  }
}

export function reportClientError(source: string, err: unknown): void {
  try {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : (() => {
              try {
                return JSON.stringify(err) ?? String(err);
              } catch {
                return String(err);
              }
            })();
    const entry = JSON.stringify({
      source,
      message,
      at: new Date().toISOString(),
      url: beaconPageUrl(),
    });
    try {
      sessionStorage.setItem('itms_last_error', entry);
    } catch {
      /* storage unavailable (private mode) — ignore */
    }
    const endpoint = (import.meta.env as Record<string, string | undefined>)[
      'VITE_ERROR_BEACON_URL'
    ];
    if (endpoint && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(endpoint, new Blob([entry], { type: 'application/json' }));
      } catch {
        /* beacon failed — ignore */
      }
    }
    if (/dynamically imported|dynamic import|Loading chunk|Failed to fetch/i.test(message)) {
      try {
        if (!sessionStorage.getItem('itms_chunk_reload')) {
          sessionStorage.setItem('itms_chunk_reload', '1');
          window.location.reload();
        }
      } catch {
        /* storage unavailable — ignore */
      }
    }
  } catch {
    /* never throw from the error sink itself */
  }
}

/** Wire the window-level handlers. Called once from main.tsx. */
export function initGlobalErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportClientError('error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError('unhandledrejection', event.reason);
  });
}
