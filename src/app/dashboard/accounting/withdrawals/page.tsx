import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/access';

// Payments have no list of their own: they are listed in the journal.
export default async function WithdrawalsPage() {
  await requireRouteAccess('/dashboard/accounting');
  redirect('/dashboard/accounting/transactions');
}
