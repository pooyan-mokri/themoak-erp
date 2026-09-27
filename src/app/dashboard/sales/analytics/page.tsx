import { getSalesAnalytics } from '@/actions/sales-analytics';
import { SalesAnalyticsDashboard } from '@/components/sales/sales-analytics-dashboard';
import { PageHeader } from '@/components/layout/page-header';
import { PrintButton } from '@/components/reports/print-button';
import { BackButton } from '@/components/ui/back-button';
import { requireRouteAccess } from '@/lib/access';

export default async function SalesAnalyticsPage() {
  await requireRouteAccess('/dashboard/sales/analytics');
  const analytics = await getSalesAnalytics();

  return (
    <div className="space-y-4">
      <PageHeader
        title="تحلیل و پیش‌بینی فروش"
        description="۹۰ روز گذشته، مقایسه با ۹۰ روز پیش از آن، و پیش‌بینی ۷ روز آینده"
        actions={
          <>
            <PrintButton />
            <span className="print:hidden">
              <BackButton href="/dashboard/sales" label="بازگشت به مدیریت فروش" />
            </span>
          </>
        }
      />

      <SalesAnalyticsDashboard data={analytics} />
    </div>
  );
}
