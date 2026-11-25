import { useEffect, useState } from 'react';

/** Reactive online/offline state via window online/offline events. */
export function useOnline() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    // A real API response succeeded — trust the fetch over a stale offline event.
    const onSuccess = () => setOnline(true);
    // Network-layer failure — only believe it when the browser agrees we're offline.
    const onFailure = () => {
      if (typeof navigator === 'undefined' || navigator.onLine === false) {
        setOnline(false);
      }
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('itms:request-success', onSuccess);
    window.addEventListener('itms:request-offline', onFailure);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('itms:request-success', onSuccess);
      window.removeEventListener('itms:request-offline', onFailure);
    };
  }, []);

  return online;
}
