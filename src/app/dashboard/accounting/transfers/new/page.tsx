import { getAccounts } from '@/actions/accounting';
import { TransferForm } from '@/components/accounting/transfer-form';

export default async function NewTransferPage() {
  const accounts = await getAccounts();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">انتقال وجه بین حساب‌ها</h1>
      <TransferForm accounts={accounts} />
    </div>
  );
}
