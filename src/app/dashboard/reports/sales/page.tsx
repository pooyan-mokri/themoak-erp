import { getSalesByProduct, getSalesByCustomer, getSalesOverTime } from '@/actions/reports';
import { SalesReport } from '@/components/reports/sales-report';
import { PageHeader } from '@/components/layout/page-header';
import { PrintButton } from '@/components/reports/print-button';
import { RangeSwitch } from '@/components/reports/range-switch';
import { bucketDaily, jalaliFull, parseRange, reportWindow } from '@/components/reports/report-window';
import { requireRouteAccess } from '@/lib/access';
import { isDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';

export default async function SalesReportsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  await requireRouteAccess('/dashboard/reports/sales');
  const searchParams = await searchParamsPromise;
  // A chosen range (4 weeks, 12 weeks, this year) wins; otherwise from/to, and by default the last 3 months.
  const range = parseRange(searchParams.range);
  const period = range ? reportWindow(range) : null;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const defaultTo = now;

  // A day asked for is Tehran's day, the last one included whole (src/lib/tehran-day.ts); the server runs in UTC.
  const day = (value: string | undefined) => (value && isDay(value) ? value : undefined);
  const from = day(searchParams.from);
  const to = day(searchParams.to);
  const startDate = period ? new Date(period.start) : from ? tehranDayStart(from) : defaultFrom;
  const endDate = period ? new Date(period.end) : to ? tehranDayEnd(to) : defaultTo;

  const [salesByProduct, salesByCustomer, salesOverTime] = await Promise.all([
    getSalesByProduct(startDate, endDate),
    getSalesByCustomer(startDate, endDate),
    getSalesOverTime(startDate, endDate, 'day'),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارش فروش"
        description={
          <>
            {period ? `${period.label} · ` : ''}
            <span className="font-mono text-[12px]">{jalaliFull(startDate.getTime())}</span> تا{' '}
            <span className="font-mono text-[12px]">{jalaliFull(endDate.getTime())}</span> · محصولات، مشتریان و روند فروش
          </>
        }
        actions={
          <>
            <RangeSwitch basePath="/dashboard/reports/sales" active={range} />
            <PrintButton />
          </>
        }
      />

      <SalesReport
        data={{
          trend: bucketDaily(salesOverTime, startDate.getTime(), endDate.getTime()),
          salesByProduct,
          salesByCustomer,
        }}
      />
    </div>
  );
}
