import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type KpiTone = 'pos' | 'neg' | 'neu';

const TONES: Record<KpiTone, string> = {
  pos: 'bg-success-soft text-success',
  neg: 'bg-danger-soft text-danger',
  neu: 'bg-secondary text-muted-foreground',
};

/** One figure: label, value (19/500) with its unit, and a real change or a note beneath. */
export function KpiCard({
  label,
  icon: Icon,
  value,
  unit,
  delta,
  note,
}: {
  label: string;
  icon?: LucideIcon;
  value: string;
  unit?: string;
  delta?: { text: string; tone: KpiTone };
  note?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {label}
      </div>
      <div className="mt-1.5 text-[19px] font-medium tabular-nums">
        {value}
        {unit && <small className="ms-1 text-[11px] font-normal text-muted-foreground">{unit}</small>}
      </div>
      {(delta || note) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          {delta && (
            <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px]', TONES[delta.tone])}>{delta.text}</span>
          )}
          {note}
        </div>
      )}
    </div>
  );
}
