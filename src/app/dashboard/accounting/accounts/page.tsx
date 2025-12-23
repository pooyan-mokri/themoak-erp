
import { getAccounts } from '@/actions/accounting';
import { AccountForm } from '@/components/accounting/account-form';
import { AccountList } from '@/components/accounting/account-list';

export default async function AccountsPage() {
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت حساب‌ها</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <AccountForm />
        <AccountList accounts={accounts} />
      </div>
    </div>
  );
}
