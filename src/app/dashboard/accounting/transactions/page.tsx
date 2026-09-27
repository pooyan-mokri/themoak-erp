import { getAccounts, getTransactions } from '@/actions/accounting';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';
import { TransactionList } from '@/components/accounting/transaction-list';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

/** Without a period the journal shows the last three months; «همه» asks for everything. */
const DEFAULT_MONTHS = 3;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; all?: string; account?: string };
}) {
  await requireRouteAccess('/dashboard/accounting');
  const { from, to, all, account } = searchParams;

  const defaultFrom = new Date();
  defaultFrom.setMonth(defaultFrom.getMonth() - DEFAULT_MONTHS);
  const range =
    all === '1' ? {} : { from: from ?? (to ? undefined : defaultFrom.toISOString().slice(0, 10)), to };

  const [transactions, role, accounts] = await Promise.all([getTransactions(range), getCurrentRole(), getAccounts()]);

  return (
    <TransactionList
      transactions={transactions}
      role={role}
      range={{ from: range.from, to: range.to, all: all === '1' }}
      truncated={transactions.length >= JOURNAL_MAX_ROWS}
      maxRows={JOURNAL_MAX_ROWS}
      accounts={accounts.map((a: any) => ({ id: a.id, name: a.name, currency: a.currency, cardNumber: a.cardNumber }))}
      // ?account=<id> opens one account's journal (the accounts page links here).
      accountId={account}
    />
  );
}
