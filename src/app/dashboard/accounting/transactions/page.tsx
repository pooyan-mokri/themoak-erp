import { getTransactions } from '@/actions/accounting';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';
import { TransactionList } from '@/components/accounting/transaction-list';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

/** Without a period the journal shows the last three months; «همه» asks for everything. */
const DEFAULT_MONTHS = 3;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; all?: string };
}) {
  await requireRouteAccess('/dashboard/accounting');
  const { from, to, all } = searchParams;

  const defaultFrom = new Date();
  defaultFrom.setMonth(defaultFrom.getMonth() - DEFAULT_MONTHS);
  const range =
    all === '1' ? {} : { from: from ?? (to ? undefined : defaultFrom.toISOString().slice(0, 10)), to };

  const [transactions, role] = await Promise.all([getTransactions(range), getCurrentRole()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">دفتر روزنامه (تراکنش‌ها)</h1>
      </div>
      <TransactionList
        transactions={transactions}
        role={role}
        range={{ from: range.from, to: range.to, all: all === '1' }}
        truncated={transactions.length >= JOURNAL_MAX_ROWS}
        maxRows={JOURNAL_MAX_ROWS}
      />
    </div>
  );
}
