/**
 * A chart axis tick for an amount in Toman, short enough for the axis and in
 * Persian digits: ۱۲۰ میلیون, ۱٫۵ میلیارد. The tooltip keeps the full amount.
 */
export function tomanTick(value: number): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیارد`;
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون`;
  return n.toLocaleString('fa-IR');
}
