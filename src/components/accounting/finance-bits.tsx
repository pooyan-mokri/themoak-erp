import { cn } from '@/lib/utils';

/**
 * Small presentation pieces shared by the finance pages of this folder
 * (exchange rates, currency trade, shareholders, loans, employee debts, AR aging).
 */

export const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);

export const CURRENCY_NAMES: Record<string, string> = { TOMAN: 'تومان', USD: 'دلار', EUR: 'یورو', CNY: 'یوآن' };

/** The indigo chart series of the design system (moak.css --series-1, 3, 4, 2). */
export const SERIES = ['#353DB2', '#7C82D0', '#A9AEDE', '#2D333D', '#C9CCEC'];

/** One horizontal bar split into parts, each as wide as its share of the whole. */
export function StackBar({
  parts,
  total,
  className,
}: {
  parts: Array<{ key: string; value: number; color: string; title?: string }>;
  /** What 100% is; the parts' sum when left out. */
  total?: number;
  className?: string;
}) {
  const whole = total ?? parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  return (
    <div className={cn('flex h-2.5 gap-0.5 overflow-hidden rounded bg-secondary', className)}>
      {whole > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} title={p.title} className="block h-full" style={{ width: `${(p.value / whole) * 100}%`, background: p.color }} />
          ))}
    </div>
  );
}

/** A dot and a label, for the legend under a StackBar. */
export function LegendItem({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}

/**
 * A line of real values, oldest at the start (the right, in RTL) and newest at
 * the end. Nothing is drawn for fewer than two points.
 */
export function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-[12px] text-muted-foreground">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  // RTL: the first (oldest) point sits at the right edge.
  const points = values.map((v, i) => `${(width - i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <polyline points={points.join(' ')} fill="none" stroke="#353DB2" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
