import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getPurchaseOrders, getSuppliers } from '@/actions/supplier';
import { SupplierList } from '@/components/suppliers/supplier-list';
import { isOpen, supplierBalances } from '@/components/suppliers/purchase-figures';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function SuppliersManagementPage() {
  await requireRouteAccess('/dashboard/suppliers');
  const [{ data: suppliers, error }, { data: orders }, canCreate, canSeeFinance] = await Promise.all([
    getSuppliers(),
    getPurchaseOrders(),
    hasPermission(['stock.manage', 'finance.manage']),
    hasPermission('finance.view'),
  ]);

  if (error) {
    return <div className="rounded-md bg-danger-soft p-4 text-[13px] text-danger">{error}</div>;
  }

  const list = orders || [];
  const openOrders: Record<string, number> = {};
  for (const order of list) if (isOpen(order)) openOrders[order.supplierId] = (openOrders[order.supplierId] ?? 0) + 1;
  const balances = canSeeFinance ? supplierBalances(list) : undefined;
  const owed = balances ? Object.values(balances).reduce((sum, b) => sum + b, 0) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="تامین‌کنندگان"
        description={
          `${(suppliers || []).length.toLocaleString('fa-IR')} تامین‌کننده` +
          (balances ? ` · مانده پرداخت ${Math.round(owed).toLocaleString('fa-IR')} تومان` : '')
        }
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/dashboard/suppliers/new">
                <Plus className="h-4 w-4" />
                تامین‌کننده جدید
              </Link>
            </Button>
          )
        }
      />
      <SupplierList suppliers={suppliers || []} canCreate={canCreate} openOrders={openOrders} balances={balances} />
    </div>
  );
}
