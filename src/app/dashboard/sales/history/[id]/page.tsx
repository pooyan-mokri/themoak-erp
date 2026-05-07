import { getOrder } from '@/actions/sales';
import { getAccounts } from '@/actions/accounting';
import { getWarehouses } from '@/actions/warehouse';
import { OrderDetails } from '@/components/sales/order-details';
import { BackButton } from '@/components/ui/back-button';
import { notFound } from 'next/navigation';

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  const [order, accounts, allWarehouses] = await Promise.all([
    getOrder(params.id),
    getAccounts(),
    getWarehouses(),
  ]);

  if (!order) {
    notFound();
  }

  const warehouses = allWarehouses.filter((w: any) => !w.isVirtual);

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/sales/history" label="بازگشت به تاریخچه فروش" />
      <OrderDetails order={order} accounts={accounts} warehouses={warehouses} />
    </div>
  );
}
