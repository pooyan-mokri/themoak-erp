import Link from 'next/link';
import { cn } from '@/lib/utils';
import { REPORT_RANGES, type ReportRange } from './report-window';

/** 4 weeks · 12 weeks · this year: underlined tabs that reload the page for the chosen range. */
export function RangeSwitch({ basePath, active }: { basePath: string; active: ReportRange | null }) {
  return (
    <nav aria-label="بازهٔ گزارش" className="inline-flex h-9 items-center gap-1 border-b print:hidden">
      {REPORT_RANGES.map((range) => (
        <Link
          key={range.id}
          href={`${basePath}?range=${range.id}`}
          scroll={false}
          aria-current={active === range.id ? 'page' : undefined}
          className={cn(
            '-mb-px inline-flex h-9 items-center border-b-2 px-3.5 text-[13.5px] transition-colors duration-150',
            active === range.id
              ? 'border-brand font-medium text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {range.label}
        </Link>
      ))}
    </nav>
  );
}
