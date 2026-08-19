import { WifiOff } from 'lucide-react';
import { Button } from '@/components/Button';

export default function Offline() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
        <WifiOff className="h-8 w-8" />
      </span>
      <h1 className="text-xl font-semibold text-primary">You're offline</h1>
      <p className="max-w-sm text-sm text-secondary">
        The app shell is cached and works without a connection, but live data needs the network.
        Reconnect and try again.
      </p>
      <Button
        onClick={() => window.location.reload()}
        variant="primary"
        className="mt-2"
      >
        Try again
      </Button>
    </div>
  );
}
