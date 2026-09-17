import { getARAgingReport } from '@/actions/invoice';
import { ARAgingReport } from '@/components/accounting/ar-aging-report';
import { requireRouteAccess } from '@/lib/access';

export default async function ARAgingPage() {
  await requireRouteAccess('/dashboard/accounting');
  const reportData = await getARAgingReport();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">گزارش سنی حساب‌های دریافتنی</h2>
      </div>

      <ARAgingReport data={reportData} />
    </div>
  );
}
