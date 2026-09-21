/**
 * Re-derive an account's balance from its transactions.
 *
 * Account.balance is a stored running total. It should equal the signed sum
 * of the account's transactions (the opening balance is an ADJUSTMENT row
 * «موجودی اولیه»). When it does not, something moved the balance without a
 * matching transaction (or vice versa).
 *
 * Signing a row is not simply INCOME/EXPENSE, because transfers and
 * adjustments are recorded inconsistently:
 *
 *  - INCOME    → credit
 *  - EXPENSE   → debit
 *  - ADJUSTMENT→ the amount is stored SIGNED (see adjustAccountBalance,
 *                createAccount and recordBalanceBaseline)
 *  - TRANSFER  → carries no direction of its own. An internal transfer made in
 *                the app writes BOTH legs as TRANSFER and marks the direction
 *                in the description ("[خروج]" out, "[ورود]" in). A transfer
 *                made through the API writes the debit leg as TRANSFER with no
 *                prefix and the credit leg as INCOME, so an unprefixed
 *                TRANSFER is always the outgoing leg.
 */

// Prisma.Decimal's own class, typed in full (src/types/prisma-types.d.ts stubs Prisma.Decimal).
import { Decimal } from '@prisma/client/runtime/library';

export type ReconcilableTransaction = {
  type: string;
  amount: unknown; // Prisma.Decimal | number | string
  description?: string | null;
};

const num = (v: unknown): number => {
  const n = Number(v as any);
  return Number.isFinite(n) ? n : 0;
};

/** Effect of one transaction on its account's balance, in the account's currency. */
export function balanceEffect(tx: ReconcilableTransaction): number {
  const amount = num(tx.amount);
  switch (tx.type) {
    case 'INCOME':
      return amount;
    case 'EXPENSE':
      return -amount;
    case 'ADJUSTMENT':
      return amount; // already signed
    case 'TRANSFER': {
      const desc = tx.description ?? '';
      if (desc.startsWith('[ورود]')) return amount;
      // "[خروج]" and the unprefixed API debit leg are both outgoing.
      return -amount;
    }
    default:
      return 0;
  }
}

/**
 * Signed sum of a set of transactions, in exact decimal arithmetic, so that
 * stored balance − this sum is exactly 0 when the ledger adds up (a float sum
 * of amounts like 0.1 leaves a remainder that never goes away).
 */
export function sumBalanceEffects(transactions: ReconcilableTransaction[]): Decimal {
  return transactions.reduce((sum: Decimal, tx) => {
    // The exact amount; anything num() cannot read counts as 0, as in balanceEffect.
    const amount = new Decimal(num(tx.amount) === 0 ? 0 : (tx.amount as Decimal.Value));
    // balanceEffect is linear in the amount, so its value for 1 is the row's sign.
    return sum.plus(amount.times(balanceEffect({ ...tx, amount: 1 })));
  }, new Decimal(0));
}

/**
 * Convert a Toman figure into the currency an account is actually kept in.
 *
 * The other half of the rule above: balanceEffect() reads Transaction.amount
 * as the account's own currency, so whatever writes the balance has to put
 * that same figure in Transaction.amount. Forms that are denominated in Toman
 * (expenses, loans) must convert before touching a foreign-currency account —
 * otherwise a Toman number is moved straight off a dollar balance.
 *
 * `client` is a Prisma client or an interactive transaction.
 */
export async function inAccountCurrency(
  client: any,
  account: { currency: string },
  amountInToman: number
): Promise<{ amount: number; rate: number }> {
  if (account.currency === 'TOMAN') {
    return { amount: amountInToman, rate: 1 };
  }
  const latestRate = await client.exchangeRate.findFirst({
    where: { currency: account.currency },
    orderBy: { date: 'desc' },
  });
  if (!latestRate) {
    throw new Error(`نرخ تبدیل برای ارز ${account.currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.`);
  }
  const rate = Number(latestRate.rateToToman);
  return { amount: amountInToman / rate, rate };
}
