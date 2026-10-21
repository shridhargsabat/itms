import { RefreshCw } from 'lucide-react';
import { useUpdatePrompt } from '@/lib/pwa';
import { Button } from '@/components/Button';

export default function UpdateToast() {
  const { updateAvailable, reload } = useUpdatePrompt();
  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-50 flex items-center gap-3 rounded-xl glass-chrome px-4 py-3 lg:bottom-4">
      <span className="text-sm text-primary">A new version is available.</span>
      <Button
        onClick={reload}
        variant="primary"
        size="sm"
        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
      >
        Reload
      </Button>
    </div>
  );
}
