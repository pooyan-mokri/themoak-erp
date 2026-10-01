import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/access';

/** The «سفارشات» breadcrumb's page (above an order's print page): the orders are listed in the sales history. */
export default async function SalesOrdersPage() {
  await requireRouteAccess('/dashboard/sales');
  redirect('/dashboard/sales/history');
}
