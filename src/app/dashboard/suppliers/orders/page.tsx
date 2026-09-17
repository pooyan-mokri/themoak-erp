import { getPurchaseOrders } from '@/actions/supplier';
import { OrderList } from '@/components/suppliers/order-list';
import { prisma } from '@/lib/prisma';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function OrdersPage() {
  await requireRouteAccess('/dashboard/suppliers');
  const { data: orders } = await getPurchaseOrders();
  const warehouses = await prisma.warehouse.findMany({
    where: { isVirtual: false, isArchived: false }
  });
  const [canSeeFinance, canEditCost] = await Promise.all([hasPermission('finance.view'), hasPermission('cost.edit')]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت سفارشات خرید</h1>
      <OrderList orders={orders || []} warehouses={warehouses} canSeeFinance={canSeeFinance} canCreate={canEditCost} />
    </div>
  );
}
