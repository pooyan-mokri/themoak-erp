/**
 * Re-derive an account's balance from its transactions.
 *
 * Account.balance is a stored running total. It should equal the account's
 * opening balance plus the signed sum of its transactions. When it does not,
 * something moved the balance without a matching transaction (or vice versa).
 *
 * Signing a row is not simply INCOME/EXPENSE, because transfers and
 * adjustments are recorded inconsistently:
 *
 *  - INCOME    → credit
 *  - EXPENSE   → debit
 *  - ADJUSTMENT→ the amount is stored SIGNED (see adjustAccountBalance)
 *  - TRANSFER  → carries no direction of its own. An internal transfer made in
 *                the app writes BOTH legs as TRANSFER and marks the direction
 *                in the description ("[خروج]" out, "[ورود]" in). A transfer
 *                made through the API writes the debit leg as TRANSFER with no
 *                prefix and the credit leg as INCOME, so an unprefixed
 *                TRANSFER is always the outgoing leg.
 */

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

/** Signed sum of a set of transactions. */
export function sumBalanceEffects(transactions: ReconcilableTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + balanceEffect(tx), 0);
}
