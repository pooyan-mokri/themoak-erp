import { getTransactions } from '@/actions/accounting';
import { TransactionList } from '@/components/accounting/transaction-list';

export default async function TransactionsPage() {
  const transactions = await getTransactions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">دفتر روزنامه (تراکنش‌ها)</h1>
      </div>
      <TransactionList transactions={transactions} />
    </div>
  );
}
