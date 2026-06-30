import { getPurchaseOrders } from '@/actions/supplier';
import { OrderList } from '@/components/suppliers/order-list';
import { prisma } from '@/lib/prisma';

export default async function OrdersPage() {
  const { data: orders } = await getPurchaseOrders();
  const warehouses = await prisma.warehouse.findMany({
    where: { isVirtual: false, isArchived: false }
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت سفارشات خرید</h1>
      <OrderList orders={orders || []} warehouses={warehouses} />
    </div>
  );
}
