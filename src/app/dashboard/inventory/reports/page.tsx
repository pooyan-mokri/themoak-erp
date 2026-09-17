import { getInventoryReport } from '@/actions/inventory-reports';
import { InventoryReport } from '@/components/inventory/inventory-report';
import { requireRouteAccess } from '@/lib/access';

export default async function InventoryReportsPage() {
  await requireRouteAccess('/dashboard/inventory/reports');
  const report = await getInventoryReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارش موجودی و انبار</h1>
        <p className="text-muted-foreground mt-2">
          گزارش جامع موجودی محصولات قابل فروش، کمبودها و توزیع موجودی
        </p>
      </div>

      <InventoryReport report={report} />
    </div>
  );
}




