import { getAccounts, getTransactions } from '@/actions/accounting';
import { WithdrawalForm } from '@/components/accounting/withdrawal-form';
import { MoneyFormSwitch } from '@/components/accounting/entry-parts';
import { recentFrom, recentPayments } from '@/components/accounting/recent-entries';
import { PageHeader } from '@/components/layout/page-header';
import { requireRouteAccess } from '@/lib/access';

export default async function NewWithdrawalPage() {
  await requireRouteAccess('/dashboard/accounting');
  const [accounts, rows] = await Promise.all([getAccounts(), getTransactions({ from: recentFrom() })]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="پرداخت جدید"
        description="برداشت از یکی از حساب‌ها و پرداخت به شخص، شرکت یا نهاد."
        actions={<MoneyFormSwitch current="payment" />}
      />
      <WithdrawalForm accounts={accounts} recent={recentPayments(rows)} />
    </div>
  );
}
