import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/access';

/** The «مدیریت» breadcrumb's page: the admin section is its users. */
export default async function AdminPage() {
  await requireRouteAccess('/dashboard/admin');
  redirect('/dashboard/admin/users');
}
