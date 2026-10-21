import { WifiOff } from 'lucide-react';
import { useOnline } from '@/lib/offline';

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 glass-chrome border-amber-500/30 px-4 py-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
      <WifiOff className="h-3.5 w-3.5" />
      You're offline — showing cached data. Reconnect to sync.
    </div>
  );
}
