import { getSalesAnalytics } from '@/actions/sales-analytics';
import { SalesAnalyticsDashboard } from '@/components/sales/sales-analytics-dashboard';
import { BackButton } from '@/components/ui/back-button';

export default async function SalesAnalyticsPage() {
  const analytics = await getSalesAnalytics();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">گزارشات و تحلیل فروش</h1>
          <p className="text-muted-foreground mt-1">
            آمار، نمودار و پیش‌بینی فروش
          </p>
        </div>
        <BackButton href="/dashboard/sales" label="بازگشت به مدیریت فروش" />
      </div>
      
      <SalesAnalyticsDashboard data={analytics} />
    </div>
  );
}

