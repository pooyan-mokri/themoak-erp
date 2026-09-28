import { getProfitLossReport, getBalanceSheet } from '@/actions/reports';
import { ProfitLossReport } from '@/components/reports/profit-loss-report';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRouteAccess } from '@/lib/access';
import { addDays, isDay, tehranDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';

export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireRouteAccess('/dashboard/reports/financial');
  // Default to current month if no dates provided. Days are Tehran's, and the
  // last one is included whole (src/lib/tehran-day.ts); the server runs in UTC.
  const today = tehranDay(new Date());
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastOfMonth = addDays(`${addDays(firstOfMonth, 31).slice(0, 8)}01`, -1);
  const day = (value: string | undefined) => (value && isDay(value) ? value : undefined);

  const startDate = tehranDayStart(day(searchParams.from) ?? firstOfMonth);
  const endDate = tehranDayEnd(day(searchParams.to) ?? lastOfMonth);

  const [profitLossData, balanceSheetData] = await Promise.all([
    getProfitLossReport(startDate, endDate),
    getBalanceSheet(endDate),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارشات مالی</h1>
        <p className="text-muted-foreground">
          تحلیل عملکرد مالی و وضعیت دارایی‌ها
        </p>
      </div>

      <Tabs defaultValue="profit-loss" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profit-loss">سود و زیان</TabsTrigger>
          <TabsTrigger value="balance-sheet">ترازنامه</TabsTrigger>
        </TabsList>

        <TabsContent value="profit-loss" className="space-y-4">
          <ProfitLossReport data={profitLossData} />
        </TabsContent>

        <TabsContent value="balance-sheet" className="space-y-4">
          <BalanceSheetReport data={balanceSheetData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
