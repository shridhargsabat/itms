import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export default function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-2xl glass-card p-2.5', className)}>
      {children}
    </div>
  );
}
