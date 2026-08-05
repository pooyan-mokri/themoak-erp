/**
 * Cost of goods sold (بهای تمام‌شده کالای فروش‌رفته).
 *
 * Under the capitalization policy (see src/lib/accounting-policy.ts) buying goods
 * is not an expense — the expense is recognised here, when the goods are sold.
 *
 * COGS is booked against a dedicated EXPENSE account whose balance is kept at 0,
 * so it reduces net profit (the P&L sums by transaction type) without ever
 * touching cash. This mirrors the pattern the consignment flow already uses.
 */
import { Prisma } from '@prisma/client';

export const COGS_ACCOUNT_NAME = 'بهای تمام‌شده کالای فروش‌رفته';
export const COGS_CATEGORY = 'COGS';

/**
 * Resolve (or create) a non-cash EXPENSE account. Balance stays 0 so it never
 * pollutes cash totals on the balance sheet.
 */
export async function ensureExpenseAccount(tx: any, name: string): Promise<string> {
  const existing = await tx.account.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { name, type: 'EXPENSE', currency: 'TOMAN', balance: 0 },
  });
  return created.id;
}

/**
 * Post the COGS leg of a sale and return the created transaction id, or null
 * when there is nothing to book. Never touches an account balance.
 */
export async function postOrderCogs(
  tx: any,
  args: { orderNumber: number; cogsTotal: number; date: Date; customerId?: string | null },
): Promise<string | null> {
  if (!(args.cogsTotal > 0)) return null;

  const accountId = await ensureExpenseAccount(tx, COGS_ACCOUNT_NAME);
  const created = await tx.transaction.create({
    data: {
      type: 'EXPENSE',
      currency: 'TOMAN',
      amount: new Prisma.Decimal(args.cogsTotal),
      amountInToman: new Prisma.Decimal(args.cogsTotal),
      rateSnapshot: 1,
      accountId,
      category: COGS_CATEGORY,
      description: `بهای تمام‌شده کالای فروش - سفارش #${args.orderNumber}`,
      customerId: args.customerId ?? undefined,
      date: args.date,
    },
  });
  return created.id;
}

/**
 * Reduce (or increase, with a positive delta) an order's booked COGS — used when
 * items are returned or exchanged. Clamped at zero so a series of returns can
 * never drive the expense negative.
 */
export async function adjustOrderCogs(tx: any, cogsTransactionId: string | null | undefined, delta: number) {
  if (!cogsTransactionId || delta === 0) return;

  const row = await tx.transaction.findUnique({ where: { id: cogsTransactionId } });
  if (!row) return;

  const next = Math.max(0, Number(row.amountInToman) + delta);
  await tx.transaction.update({
    where: { id: cogsTransactionId },
    data: {
      amount: new Prisma.Decimal(next),
      amountInToman: new Prisma.Decimal(next),
    },
  });
}

/** Remove an order's COGS entirely (order cancelled — the goods came back). */
export async function deleteOrderCogs(tx: any, cogsTransactionId: string | null | undefined) {
  if (!cogsTransactionId) return;
  await tx.transaction.deleteMany({ where: { id: cogsTransactionId } });
}
