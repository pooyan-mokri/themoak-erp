/**
 * The non-cash EXPENSE accounts the sales and consignment actions book their
 * P&L rows on: cost of goods sold and partner commission. Their balance is
 * kept at 0 (the rows never move it), so they feed the P&L, which sums rows
 * by type, without touching the cash total. Server only, not a server action.
 */

export const COGS_ACCOUNT_NAME = 'بهای تمام‌شده کالای فروش‌رفته';
export const COMMISSION_ACCOUNT_NAME = 'کمیسیون همکاران امانی';

/** The EXPENSE account of that name, made on first use. */
export async function ensureExpenseAccount(tx: any, name: string): Promise<string> {
  const existing = await tx.account.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { name, type: 'EXPENSE', currency: 'TOMAN', balance: 0 },
  });
  return created.id;
}
