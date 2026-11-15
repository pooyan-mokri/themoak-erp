import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getProfitLossReport, getBalanceSheet } from '@/actions/reports';
import { ProfitLossReport } from '@/components/reports/profit-loss-report';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import {
  PERIOD_KINDS,
  atParam,
  nextPeriodStart,
  periodAt,
  previousPeriod,
  resolvePeriod,
  trailingMonths,
} from '@/components/reports/pnl-periods';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { requireRouteAccess } from '@/lib/access';

/**
 * گزارش‌های مالی (profit.view): سود و زیان ماهانه، فصلی یا سالانه در تقویم شمسی،
 * کنار دوره قبل، با ترکیب درآمد و هزینه و روند دوازده ماه؛ و ترازنامه.
 */
export default async function FinancialReportsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ from?: string; to?: string; period?: string; at?: string }>;
}) {
  await requireRouteAccess('/dashboard/reports/financial');
  const searchParams = await searchParamsPromise;
  // The current Jalali month unless the URL asks for another period.
  const current = resolvePeriod(searchParams);
  const previous = previousPeriod(current);
  const months = trailingMonths(current.to, 12);

  const [[profitLossData, previousData, balanceSheetData], monthly] = await Promise.all([
    Promise.all([
      getProfitLossReport(current.from, current.to),
      getProfitLossReport(previous.from, previous.to),
      getBalanceSheet(current.to),
    ]),
    // The chart in Jalali months: the same report, one month at a time.
    Promise.all(months.map((month) => getProfitLossReport(month.from, month.to))),
  ]);
  const trend = months.map((month, i) => ({
    label: month.label,
    income: monthly[i].summary.income,
    expenses: monthly[i].summary.expenses,
    profit: monthly[i].summary.netProfit,
  }));

  const kind = current.kind === 'custom' ? null : current.kind;
  const hrefFor = (k: string, at: Date) => `/dashboard/reports/financial?period=${k}&at=${atParam(at)}`;
  const nextStart = nextPeriodStart(current);
  const hasNext = kind !== null && nextStart.getTime() <= Date.now();

  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارش‌های مالی"
        description={`سود و زیان ${current.label} در برابر ${previous.label}`}
        actions={
          <>
            <div className="inline-flex rounded-md border bg-secondary p-[3px]">
              {PERIOD_KINDS.map((option) => (
                <Link
                  key={option.id}
                  href={hrefFor(option.id, kind ? current.from : new Date())}
                  className={cn(
                    'inline-flex h-[30px] items-center rounded-[6px] px-3.5 text-[13px] transition-colors duration-150',
                    kind === option.id
                      ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border))]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </Link>
              ))}
            </div>
            {kind && (
              <div className="inline-flex items-center gap-1">
                <Button variant="outline" size="icon" asChild title={`دوره قبل: ${previous.label}`}>
                  <Link href={hrefFor(kind, previous.from)}>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
                <span className="min-w-[96px] text-center text-[13px] font-medium">{current.label}</span>
                {hasNext ? (
                  <Button variant="outline" size="icon" asChild title={`دوره بعد: ${periodAt(kind, nextStart).label}`}>
                    <Link href={hrefFor(kind, nextStart)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="icon" disabled title="دوره بعد هنوز نرسیده است">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </>
        }
      />

      <Tabs defaultValue="profit-loss" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profit-loss">سود و زیان</TabsTrigger>
          <TabsTrigger value="balance-sheet">ترازنامه</TabsTrigger>
        </TabsList>

        <TabsContent value="profit-loss">
          <ProfitLossReport
            data={profitLossData}
            previous={previousData}
            periodLabel={current.label}
            previousLabel={previous.label}
            trend={trend}
          />
        </TabsContent>

        <TabsContent value="balance-sheet">
          <BalanceSheetReport data={balanceSheetData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
