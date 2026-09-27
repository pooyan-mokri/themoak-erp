import { getAccounts, getTransactions } from '@/actions/accounting';
import { AccountList, type AccountRow } from '@/components/accounting/account-list';
import { historyStart, weeklyBalances } from '@/components/accounting/balance-history';
import { directionOf } from '@/components/accounting/money-direction';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';

const WEEKS = 8;
/** A day before the given moment, as the journal's address carries it, so no row after it is cut off by the time zone. */
const dayBefore = (date: Date) => new Date(date.getTime() - 86_400_000 - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default async function AccountsPage() {
  await requireRouteAccess('/dashboard/accounting');
  const now = new Date();
  const since = historyStart(now, WEEKS);
  const [accounts, rows, canManage] = await Promise.all([
    getAccounts(),
    // The last eight weeks of the journal: each account's movements and, walked back
    // from its balance, its trend.
    getTransactions({ from: dayBefore(since) }),
    hasPermission('finance.manage'),
  ]);
  const complete = rows.length < JOURNAL_MAX_ROWS;

  const byAccount = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.accountId) continue;
    const own = byAccount.get(row.accountId);
    if (own) own.push(row);
    else byAccount.set(row.accountId, [row]);
  }

  const list: AccountRow[] = accounts.map((account: any) => {
    const own = byAccount.get(account.id) ?? [];
    // A system EXPENSE account (COGS, commission) is a P&L bucket kept at 0: its rows never
    // moved its balance, so walking back through them would draw money it never held.
    const bucket = account.type === 'EXPENSE';
    const history = complete && !bucket ? weeklyBalances(account.balance, own, now, WEEKS) : null;
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: account.balance,
      cardNumber: account.cardNumber,
      sheba: account.sheba,
      createdAt: account.createdAt,
      history,
      historyGap: history
        ? null
        : bucket
          ? 'حساب سیستمی است و موجودی آن با سندهایش جابه‌جا نمی‌شود.'
          : !complete
            ? 'دفتر این هشت هفته بیش از سقف نمایش است؛ روند ساخته نشد.'
            : 'سندی با مبلغ پنهان (بهای تمام‌شده) دارد؛ روند ساخته نشد.',
      movements: own
        .filter((row: any) => new Date(row.date) > since)
        .map((row: any) => ({
          id: row.id,
          date: row.date,
          description: row.description,
          category: row.category,
          amount: row.amount,
          direction: directionOf(row),
        })),
    };
  });

  return <AccountList accounts={list} canManage={canManage} />;
}
