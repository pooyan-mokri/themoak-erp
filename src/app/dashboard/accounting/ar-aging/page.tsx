import { getARAgingReport } from '@/actions/invoice';
import { ARAgingReport } from '@/components/accounting/ar-aging-report';
import { requireRouteAccess } from '@/lib/access';

/** حساب‌های دریافتنی: جمع هر بازه سنی، ترکیب سنی هر مشتری، مبلغ دقیق هر بازه و جمع کل. */
export default async function ARAgingPage() {
  await requireRouteAccess('/dashboard/accounting');
  const reportData = await getARAgingReport();

  return <ARAgingReport data={reportData} />;
}
