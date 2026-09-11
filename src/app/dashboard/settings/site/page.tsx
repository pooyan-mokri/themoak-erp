import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getSiteConnectionForm } from '@/actions/site-connection';
import { SiteConnectionSettings } from '@/components/settings/site-connection-settings';

// The manual photo sync runs from this page: one catalogue read plus small writes.
export const maxDuration = 60;

export default async function SiteConnectionPage() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    redirect('/dashboard/settings/profile');
  }
  const form = await getSiteConnectionForm();
  return <SiteConnectionSettings initial={form} />;
}
