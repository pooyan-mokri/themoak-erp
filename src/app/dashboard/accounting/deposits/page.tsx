import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/access';

// Deposits have no list of their own: they are listed in the journal.
export default async function DepositsPage() {
  await requireRouteAccess('/dashboard/accounting');
  redirect('/dashboard/accounting/transactions');
}
