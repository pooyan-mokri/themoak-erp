import { getPurchaseOrder } from '@/actions/supplier';
import { getAccountOptions } from '@/actions/account-options';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { OrderDetail } from '@/components/suppliers/order-detail';
import { BackButton } from '@/components/ui/back-button';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/suppliers');
  const { data: order } = await getPurchaseOrder(params.id);
  const warehouses = await prisma.warehouse.findMany({
    where: { isVirtual: false, isArchived: false }
  });
  const [canSeeCost, canSeeFinance, canManageStock, canManageFinance, canEditCost] = await Promise.all([
    hasPermission('cost.view'),
    hasPermission('finance.view'),
    hasPermission('stock.manage'),
    hasPermission('finance.manage'),
    hasPermission('cost.edit'),
  ]);
  // Only the payment and arrival dialogs pick an account.
  const accounts = canManageFinance ? await getAccountOptions() : [];

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/suppliers/orders" label="بازگشت به لیست سفارشات خرید" />
      <OrderDetail
        order={order}
        warehouses={warehouses}
        accounts={accounts}
        canSeeCost={canSeeCost}
        canSeeFinance={canSeeFinance}
        canChangeStatus={canManageStock || canManageFinance}
        canPay={canManageFinance}
        canRecordArrival={canEditCost && canManageFinance}
        canReceive={canManageStock}
      />
    </div>
  );
}

