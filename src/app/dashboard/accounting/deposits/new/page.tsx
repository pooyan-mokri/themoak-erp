import { getAccounts, getTransactions } from '@/actions/accounting';
import { DepositForm } from '@/components/accounting/deposit-form';
import { MoneyFormSwitch } from '@/components/accounting/entry-parts';
import { recentDeposits, recentFrom } from '@/components/accounting/recent-entries';
import { PageHeader } from '@/components/layout/page-header';
import { requireRouteAccess } from '@/lib/access';

export default async function NewDepositPage() {
  await requireRouteAccess('/dashboard/accounting');
  const [accounts, rows] = await Promise.all([getAccounts(), getTransactions({ from: recentFrom() })]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="واریز جدید"
        description="ورود پول به یکی از حساب‌های شرکت: واریز نقدی یا بانکی، سرمایه، وام یا برگشت وجه."
        actions={<MoneyFormSwitch current="deposit" />}
      />
      <DepositForm accounts={accounts} recent={recentDeposits(rows)} />
    </div>
  );
}
