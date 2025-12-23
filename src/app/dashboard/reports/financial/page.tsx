import { getProfitLossReport, getBalanceSheet } from '@/actions/reports';
import { ProfitLossReport } from '@/components/reports/profit-loss-report';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  // Default to current month if no dates provided
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDate = searchParams.from ? new Date(searchParams.from) : defaultFrom;
  const endDate = searchParams.to ? new Date(searchParams.to) : defaultTo;

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
