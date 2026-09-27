/** A plain indigo line through a few real points, oldest first (design system: the chart series is the brand). */
export function Sparkline({
  points,
  width = 56,
  height = 18,
  label,
}: {
  points: number[];
  width?: number;
  height?: number;
  label?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const range = Math.max(...points) - min || 1;
  const line = points
    .map((value, i) => `${((i / (points.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / range) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block shrink-0 text-brand"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Time runs left to right in a chart, also on a right-to-left page.
      style={{ direction: 'ltr' }}
    >
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
