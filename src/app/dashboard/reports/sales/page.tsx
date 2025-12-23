import { getSalesByProduct, getSalesByCustomer, getSalesOverTime } from '@/actions/reports';
import { SalesReport } from '@/components/reports/sales-report';
import { Card } from '@/components/ui/card';

export default async function SalesReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  // Default to last 3 months
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const defaultTo = now;

  const startDate = searchParams.from ? new Date(searchParams.from) : defaultFrom;
  const endDate = searchParams.to ? new Date(searchParams.to) : defaultTo;

  const [salesByProduct, salesByCustomer, salesOverTime] = await Promise.all([
    getSalesByProduct(startDate, endDate),
    getSalesByCustomer(startDate, endDate),
    getSalesOverTime(startDate, endDate, 'month'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارشات فروش</h1>
        <p className="text-muted-foreground">
          تحلیل عملکرد فروش و مشتریان
        </p>
      </div>

      <SalesReport 
data={{
          salesOverTime,
          salesByProduct,
          salesByCustomer,
        }}
      />
    </div>
  );
}
