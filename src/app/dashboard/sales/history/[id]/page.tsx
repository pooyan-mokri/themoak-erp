import { getOrder } from '@/actions/sales';
import { getAccounts } from '@/actions/accounting';
import { OrderDetails } from '@/components/sales/order-details';
import { BackButton } from '@/components/ui/back-button';
import { notFound } from 'next/navigation';

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  const order = await getOrder(params.id);
  const accounts = await getAccounts();

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/sales/history" label="بازگشت به تاریخچه فروش" />
      <OrderDetails order={order} accounts={accounts} />
    </div>
  );
}
