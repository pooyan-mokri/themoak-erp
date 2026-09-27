import type { ReactNode } from 'react';
import { SectionCard } from '@/components/dashboard/section-card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** One settings block: a 14/500 title, a line on what it does, an optional action, then its fields. */
export function SettingsPanel({
  title,
  description,
  count,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionCard title={title} count={count} aside={action}>
      {description && <p className="-mt-1.5 mb-3 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {children}
    </SectionCard>
  );
}

/** A label beside its field (stacked on a phone), with an optional hint under the field. */
export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 py-2 sm:grid-cols-[176px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={htmlFor} className="text-[12.5px] font-normal leading-9 text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** The buttons at the foot of a panel, after a hairline. */
export function PanelActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-3 flex flex-wrap items-center gap-2 border-t pt-3', className)}>{children}</div>;
}

/** A result in colour and words (design system §12): success, a problem, or something in progress. */
export function StatusNote({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-brand-soft text-brand',
    neutral: 'bg-secondary text-foreground',
  };
  return <div className={cn('rounded-md px-3 py-2.5 text-[12.5px] leading-relaxed', tones[tone], className)}>{children}</div>;
}
