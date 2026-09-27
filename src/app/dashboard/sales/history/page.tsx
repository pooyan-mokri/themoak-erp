import { getOrders } from '@/actions/sales';
import { OrderList } from '@/components/sales/order-list';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/**
 * سفارش‌ها و فروش: نماهای سریع، جستجو و فیلتر، انتخاب چندتایی، پنل جزئیات کنار
 * جدول، ثبت پرداخت، لغو سفارش و خروجی اکسل.
 */
export default async function SalesHistoryPage() {
  await requireRouteAccess('/dashboard/sales');
  const [orders, canManage] = await Promise.all([getOrders(), hasPermission('sales.manage')]);
  return <OrderList orders={orders} canManage={canManage} />;
}
