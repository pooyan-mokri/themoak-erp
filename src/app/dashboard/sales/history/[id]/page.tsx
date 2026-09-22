import { getOrder } from '@/actions/sales';
import { getAccountOptions } from '@/actions/account-options';
import { getWarehouses } from '@/actions/warehouse';
import { getOrderReturns } from '@/actions/order-return';
import { getOrderExchanges } from '@/actions/order-exchange';
import { OrderDetails } from '@/components/sales/order-details';
import { BackButton } from '@/components/ui/back-button';
import { notFound } from 'next/navigation';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/sales');
  const [order, allAccounts, allWarehouses, returns, exchanges, role] = await Promise.all([
    getOrder(params.id),
    getAccountOptions(),
    getWarehouses(),
    getOrderReturns(params.id),
    getOrderExchanges(params.id),
    getCurrentRole(),
  ]);

  if (!order) {
    notFound();
  }

  // Refund / exchange cash legs must hit a real cash source, not an
  // expense bucket — match the server-side guard.
  const accounts = allAccounts.filter((a: any) => a.type === 'BANK' || a.type === 'CASH');

  // For consignment sales, also allow the partner's own virtual warehouse
  // as a return/exchange destination — the goods physically went back to
  // the partner. Other partners' virtual warehouses must stay hidden.
  const partnerWarehouseIds = new Set(
    ((order.customer as any)?.warehouses || []).map((w: any) => w.id)
  );
  const warehouses = allWarehouses.filter(
    (w: any) => !w.isVirtual || partnerWarehouseIds.has(w.id)
  );

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/sales/history" label="بازگشت به تاریخچه فروش" />
      <OrderDetails
        order={order}
        accounts={accounts}
        warehouses={warehouses}
        returns={returns}
        exchanges={exchanges}
        role={role}
      />
    </div>
  );
}
