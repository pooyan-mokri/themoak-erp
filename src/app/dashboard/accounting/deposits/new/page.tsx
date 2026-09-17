import { getAccounts } from '@/actions/accounting';
import { DepositForm } from '@/components/accounting/deposit-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewDepositPage() {
  await requireRouteAccess('/dashboard/accounting');
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">ثبت واریز</h1>
      <DepositForm accounts={accounts} />
    </div>
  );
}
