import { getOrders } from '@/actions/sales';
import { OrderList } from '@/components/sales/order-list';

/**
 * صفحه تاریخچه سفارشات فروش
 * شامل امکانات: جستجو، فیلتر، ثبت پرداخت، لغو سفارش، دانلود Excel
 */
export default async function SalesHistoryPage() {
  const orders = await getOrders();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تاریخچه سفارشات</h1>
      <OrderList orders={orders} />
    </div>
  );
}
