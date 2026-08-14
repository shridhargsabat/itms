import { RefreshCw } from 'lucide-react';
import { useUpdatePrompt } from '@/lib/pwa';

export default function UpdateToast() {
  const { updateAvailable, reload } = useUpdatePrompt();
  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur">
      <span className="text-sm text-slate-200">A new version is available.</span>
      <button
        onClick={reload}
        className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-400"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Reload
      </button>
    </div>
  );
}
