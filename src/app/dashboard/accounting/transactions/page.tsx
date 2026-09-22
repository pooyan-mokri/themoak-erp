import { getTransactions } from '@/actions/accounting';
import { TransactionList } from '@/components/accounting/transaction-list';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

export default async function TransactionsPage() {
  await requireRouteAccess('/dashboard/accounting');
  const [transactions, role] = await Promise.all([getTransactions(), getCurrentRole()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">دفتر روزنامه (تراکنش‌ها)</h1>
      </div>
      <TransactionList transactions={transactions} role={role} />
    </div>
  );
}
