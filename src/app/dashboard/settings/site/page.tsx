import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getSiteConnectionForm } from '@/actions/site-connection';
import { getOrders } from '@/actions/sales';
import { SiteConnectionSettings } from '@/components/settings/site-connection-settings';
import { siteOrderSummary } from '@/components/settings/site-orders';
import { requireRouteAccess } from '@/lib/access';

// The manual photo sync runs from this page: one catalogue read plus small writes.
export const maxDuration = 60;

export default async function SiteConnectionPage() {
  await requireRouteAccess('/dashboard/settings/site');
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    redirect('/dashboard/settings/profile');
  }
  const [form, orders] = await Promise.all([getSiteConnectionForm(), getOrders()]);
  // Only the figures and the latest few orders go to the browser, not every order.
  return <SiteConnectionSettings initial={form} siteOrders={siteOrderSummary(orders)} />;
}
