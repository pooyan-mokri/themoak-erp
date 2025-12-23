import { getPurchaseOrder } from '@/actions/supplier';
import { getAccounts } from '@/actions/accounting';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { OrderDetail } from '@/components/suppliers/order-detail';
import { BackButton } from '@/components/ui/back-button';

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const { data: order } = await getPurchaseOrder(params.id);
  const warehouses = await prisma.warehouse.findMany({
    where: { isVirtual: false }
  });
  const accounts = await getAccounts();

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/suppliers/orders" label="بازگشت به لیست سفارشات خرید" />
      <OrderDetail order={order} warehouses={warehouses} accounts={accounts} />
    </div>
  );
}

