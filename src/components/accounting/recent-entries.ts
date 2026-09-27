import { formatJalaliDate } from '@/lib/date-utils';
import { DEPOSIT_CATEGORIES, DEPOSIT_DEFAULT_CATEGORY, EXPENSE_CATEGORIES, PAYMENT_CATEGORIES } from './entry-categories';
import type { RecentExpense } from './expense-form';
import type { RecentDeposit } from './deposit-form';
import type { RecentPayment } from './withdrawal-form';
import type { RecentTransfer } from './transfer-form';

/**
 * The recent entries each money form offers to repeat, picked out of journal
 * rows the page already read with getTransactions (finance.view) — rows shaped
 * the way that form writes them. Server-side, for the form pages.
 */

const SHOWN = 6;
/** How far back the form pages read the journal for them. */
export const RECENT_DAYS = 30;

/** The day RECENT_DAYS ago, as getTransactions takes it. */
export function recentFrom(now = new Date()): string {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  return new Date(since.getTime() - since.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const day = (date: Date | string) => formatJalaliDate(date, 'jMM/jDD');
const line = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const expenseLabel = (value: string) => EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;

/** Expenses the expense form made: one of its categories, from an account or an employee, no payee. */
export function recentExpenses(rows: any[]): RecentExpense[] {
  const values = EXPENSE_CATEGORIES.map((c) => c.value);
  return rows
    .filter((t) => t.type === 'EXPENSE' && values.includes(t.category) && !t.payee && !t.orderId && t.amount != null && (t.accountId || t.employeeId))
    .slice(0, SHOWN)
    .map((t) => {
      // The form stores «<category> - <description>».
      const text = (t.description ?? '').startsWith(`${t.category} - `) ? t.description.slice(t.category.length + 3) : '';
      return {
        id: t.id,
        title: text || expenseLabel(t.category),
        sub: line(expenseLabel(t.category), t.account?.name ?? t.employee?.name, day(t.date)),
        amount: t.amount,
        currency: t.currency,
        fill: { accountId: t.accountId, employeeId: t.employeeId, category: t.category },
      };
    });
}

/** Deposits the deposit form made: money in on an account, not an order's, in one of its categories. */
export function recentDeposits(rows: any[]): RecentDeposit[] {
  const categories = [...DEPOSIT_CATEGORIES, DEPOSIT_DEFAULT_CATEGORY];
  return rows
    .filter((t) => t.type === 'INCOME' && !t.orderId && categories.includes(t.category) && t.accountId && t.amount != null && t.description)
    .slice(0, SHOWN)
    .map((t) => ({
      id: t.id,
      title: t.description,
      sub: line(t.category, t.account?.name, day(t.date)),
      amount: t.amount,
      currency: t.currency,
      fill: {
        accountId: t.accountId,
        category: DEPOSIT_CATEGORIES.includes(t.category) ? t.category : undefined,
        description: t.description,
      },
    }));
}

/** Payments: money out of an account to a named payee. */
export function recentPayments(rows: any[]): RecentPayment[] {
  return rows
    .filter((t) => t.type === 'EXPENSE' && t.payee && t.accountId && t.amount != null)
    .slice(0, SHOWN)
    .map((t) => ({
      id: t.id,
      title: t.payee,
      sub: line(t.category, t.account?.name, day(t.date)),
      amount: t.amount,
      currency: t.currency,
      fill: {
        accountId: t.accountId,
        payee: t.payee,
        category: PAYMENT_CATEGORIES.includes(t.category) ? t.category : undefined,
      },
    }));
}

/** Transfers with both legs in the books (getInternalTransfers, newest first). */
export function recentTransfers(
  transfers: { id: string; date: Date | string; fromAccountId: string | null; toAccountId: string | null; fromAccount: string | null; toAccount: string | null; amount: number; currency: string; description: string; complete: boolean }[],
): RecentTransfer[] {
  return transfers
    .filter((t) => t.complete && t.fromAccountId && t.toAccountId)
    .slice(0, SHOWN)
    .map((t) => ({
      id: t.id,
      title: `${t.fromAccount} ← ${t.toAccount}`,
      sub: line(day(t.date), t.description),
      amount: t.amount,
      currency: t.currency,
      fill: { fromAccountId: t.fromAccountId!, toAccountId: t.toAccountId! },
    }));
}
