import { getAccounts } from '@/actions/accounting';
import { WithdrawalForm } from '@/components/accounting/withdrawal-form';

export default async function NewWithdrawalPage() {
  const accounts = await getAccounts();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">ثبت پرداخت / برداشت</h1>
      <WithdrawalForm accounts={accounts} />
    </div>
  );
}
