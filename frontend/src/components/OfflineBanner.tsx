import { WifiOff } from 'lucide-react';
import { useOnline } from '@/lib/offline';

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-[calc(2.875rem+env(safe-area-inset-top))] z-50 flex items-center justify-center gap-2 border-b border-amber-500/30 glass-chrome px-4 py-1.5 text-xs font-semibold text-amber-600 lg:top-0 dark:text-amber-400">
      <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
      You're offline — showing cached data. Reconnect to sync.
    </div>
  );
}
