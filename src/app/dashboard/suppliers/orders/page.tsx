import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getPurchaseOrders } from '@/actions/supplier';
import { OrderList } from '@/components/suppliers/order-list';
import { PurchaseKpis } from '@/components/suppliers/purchase-kpis';
import { purchaseFigures } from '@/components/suppliers/purchase-figures';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/prisma';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function OrdersPage() {
  await requireRouteAccess('/dashboard/suppliers');
  const { data: orders } = await getPurchaseOrders();
  const warehouses = await prisma.warehouse.findMany({
    where: { isVirtual: false, isArchived: false }
  });
  const [canSeeFinance, canEditCost] = await Promise.all([hasPermission('finance.view'), hasPermission('cost.edit')]);
  const list = orders || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="سفارش‌های خرید"
        description={`${list.length.toLocaleString('fa-IR')} سفارش · از ثبت تا پرداخت، تولید، رسیدن و دریافت در انبار`}
        actions={
          canEditCost && (
            <Button asChild>
              <Link href="/dashboard/suppliers/orders/new">
                <Plus className="h-4 w-4" />
                سفارش جدید
              </Link>
            </Button>
          )
        }
      />
      <PurchaseKpis figures={purchaseFigures(list)} />
      <OrderList orders={list} warehouses={warehouses} canSeeFinance={canSeeFinance} canCreate={canEditCost} />
    </div>
  );
}
