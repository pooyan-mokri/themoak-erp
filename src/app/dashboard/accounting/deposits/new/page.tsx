import { getAccounts } from '@/actions/accounting';
import { DepositForm } from '@/components/accounting/deposit-form';

export default async function NewDepositPage() {
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">ثبت واریز</h1>
      <DepositForm accounts={accounts} />
    </div>
  );
}
