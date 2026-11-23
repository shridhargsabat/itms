import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, actions, className }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
