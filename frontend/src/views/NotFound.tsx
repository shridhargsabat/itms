import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { BUTTON } from '@/components/Button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <FileQuestion className="h-8 w-8" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold text-primary">Page not found</h1>
      <p className="max-w-sm text-sm text-secondary">
        The page you&apos;re looking for doesn&apos;t exist or was moved. Check the URL or head back to the
        dashboard.
      </p>
      <Link to="/" className={cn(BUTTON.base, BUTTON.primary, BUTTON.md, 'mt-2')}>
        Back to dashboard
      </Link>
    </div>
  );
}
