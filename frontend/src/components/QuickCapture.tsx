import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, QrCode } from 'lucide-react';
import { getCachedUser } from '@/api/client';
import { cn } from '@/lib/utils';
import Modal from '@/components/Modal';
import AddAssetForm from '@/components/AddAssetForm';

/**
 * Quick Capture glass dock at the bottom of the sidebar (ref mockup
 * "Quick ITAM Capture Dock"): Invoice opens the shared AddAssetForm modal
 * (same title + form as AddAssetButton; admin-only) and Scan navigates to
 * /scan. Wide renders a labeled 2-up grid; the collapsed rail renders an
 * icon-only stack with titles. Dock chrome is the Task 3 subcard; button
 * fills ride the glass guard chains in index.css (.quick-capture-btn).
 */
export default function QuickCapture({ wide }: { wide: boolean }) {
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'manual' | 'invoice'>('manual');
  const navigate = useNavigate();
  const isAdmin = getCachedUser()?.role === 'ADMIN';
  const openInvoice = () => {
    setInitialTab('invoice');
    setOpen(true);
  };

  return (
    <>
      {wide ? (
        <div className="quick-capture-dock liquid-glass-subcard p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-primary">Quick Capture</span>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#34C759]" />
          </div>
          <div className={cn('grid gap-2', isAdmin ? 'grid-cols-2' : 'grid-cols-1')}>
            {isAdmin && (
              <button
                type="button"
                onClick={openInvoice}
                className="quick-capture-btn flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#007AFF]" aria-hidden="true" />
                Invoice
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/scan')}
              className="quick-capture-btn flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium"
            >
              <QrCode className="h-3.5 w-3.5 text-[#AF52DE]" aria-hidden="true" />
              Scan
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-capture-dock liquid-glass-subcard flex flex-col items-center gap-2 p-2">
          {isAdmin && (
            <button
              type="button"
              title="Invoice"
              aria-label="Invoice"
              onClick={openInvoice}
              className="quick-capture-btn flex h-9 w-9 items-center justify-center"
            >
              <FileSpreadsheet className="h-4 w-4 text-[#007AFF]" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            title="Scan"
            aria-label="Scan"
            onClick={() => navigate('/scan')}
            className="quick-capture-btn flex h-9 w-9 items-center justify-center"
          >
            <QrCode className="h-4 w-4 text-[#AF52DE]" aria-hidden="true" />
          </button>
        </div>
      )}
      {open && (
        <Modal title="Add Asset" onClose={() => setOpen(false)}>
          <AddAssetForm onDone={() => setOpen(false)} defaultTab={initialTab} />
        </Modal>
      )}
    </>
  );
}
