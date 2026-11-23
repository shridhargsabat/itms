import { useState } from 'react';
import { Plus } from 'lucide-react';
import { getCachedUser } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/Button';
import Modal from '@/components/Modal';
import AddAssetForm from '@/components/AddAssetForm';

/**
 * Single shared "Add Asset" button + dialog used on BOTH the Dashboard and the
 * Assets page. The triggers are byte-identical (variant=primary, size=lg,
 * Plus icon, "Add Asset" label) and open the SAME shared AddAssetForm, so a
 * user adding an asset from either place gets the identical experience.
 *
 * Admin-gated: returns null for non-ADMIN users (matching the prior gate on
 * both call sites).
 */
export default function AddAssetButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const isAdmin = getCachedUser()?.role === 'ADMIN';
  if (!isAdmin) return null;

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="primary"
        size="lg"
        className={cn('liquid-glass-btn-primary', className)}
        leftIcon={<Plus className="h-4 w-4" />}
      >
        Add Asset
      </Button>
      {open && (
        <Modal title="Add Asset" onClose={() => setOpen(false)}>
          <AddAssetForm onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
