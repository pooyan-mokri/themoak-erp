import { Prisma } from '@prisma/client';
import { COGS_ACCOUNT_NAME, ensureExpenseAccount } from '@/lib/expense-accounts';
import { COGS_CATEGORY } from '@/lib/profit-rows';

/**
 * Cost of goods sold: on Pooyan's COGS-basis profit and loss, the only expense
 * goods ever become (src/lib/profit-rows.ts). Each is a non-cash EXPENSE row,
 * category 'COGS', on the COGS account whose balance it never moves, linked to
 * its order:
 *
 *  - goods that leave on a sale book their cost: a POS sale (sales.ts), a
 *    partner's reported consignment sale (consignment.ts), a website sale
 *    (site-sale.ts) and the new goods of an exchange (order-exchange.ts);
 *  - goods that come back book a negative row: a return (order-return.ts),
 *    the goods given back in an exchange, a website sale restocked. They are
 *    valued at the product's cost now, the value they re-enter stock at, and
 *    never at more than the order's COGS rows still add up to, so a sale
 *    booked before COGS existed is never taken below zero.
 *
 * The description starts with the row's source (COGS_SOURCES), which the
 * expense list names. Server only, inside the caller's transaction.
 */

export const COGS_SOURCES = {
  pos: 'بهای تمام‌شده کالای فروش صندوق',
  consignment: 'بهای تمام‌شده کالای فروش امانی',
  website: 'بهای تمام‌شده کالای فروش سایت',
  exchange: 'بهای تمام‌شده کالای تعویضی',
  return: 'برگشت بهای تمام‌شده کالای مرجوعی',
  exchangeBack: 'برگشت بهای تمام‌شده کالای تعویض‌شده',
  websiteRestock: 'برگشت بهای تمام‌شده کالای برگشتی سایت',
} as const;

export type CogsSource = keyof typeof COGS_SOURCES;

/** Cost of goods sold as one figure, whatever the source. */
export const COGS_LABEL = 'بهای تمام‌شده کالای فروش‌رفته';

/** What a COGS row is, from its description; a row that names no source is a sale's. */
export function cogsSourceLabel(description?: string | null): string {
  const label = Object.values(COGS_SOURCES).find((source) => description?.startsWith(source));
  return label ?? COGS_LABEL;
}

type GoodsLine = { productId: string; quantity: number };

/** Σ quantity × the product's cost price now, in Toman. */
export async function costOfGoods(tx: any, lines: GoodsLine[]): Promise<number> {
  const ids = Array.from(new Set(lines.map((line) => line.productId)));
  if (ids.length === 0) return 0;
  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, costPrice: true } });
  const costOf = new Map<string, number>(products.map((p: any) => [p.id, Number(p.costPrice || 0)]));
  return lines.reduce((sum, line) => sum + line.quantity * (costOf.get(line.productId) ?? 0), 0);
}

/** What the order's COGS rows add up to now: its sales' cost less the goods that came back. */
export async function cogsOnOrder(tx: any, orderId: string): Promise<number> {
  const sum = await tx.transaction.aggregate({ where: { orderId, category: COGS_CATEGORY }, _sum: { amountInToman: true } });
  return Number(sum._sum.amountInToman ?? 0);
}

type OrderRef = { id: string; number: number; customerId?: string | null };

async function writeCogs(tx: any, order: OrderRef, source: CogsSource, amount: number, date: Date) {
  await tx.transaction.create({
    data: {
      type: 'EXPENSE',
      currency: 'TOMAN',
      amount: new Prisma.Decimal(amount),
      amountInToman: new Prisma.Decimal(amount),
      rateSnapshot: 1,
      accountId: await ensureExpenseAccount(tx, COGS_ACCOUNT_NAME),
      category: COGS_CATEGORY,
      description: `${COGS_SOURCES[source]} - سفارش #${order.number}`,
      customerId: order.customerId ?? undefined,
      orderId: order.id,
      date,
    },
  });
}

/** Goods leaving on a sale: one row at their cost now. Nothing when they cost nothing. */
export async function bookSaleCogs(tx: any, order: OrderRef, source: CogsSource, lines: GoodsLine[], date: Date): Promise<number> {
  const cost = await costOfGoods(tx, lines);
  if (cost > 0) await writeCogs(tx, order, source, cost, date);
  return cost;
}

/**
 * Goods coming back: a negative row at their cost now, at most what the
 * order's COGS rows still add up to. Returns what was taken off.
 */
export async function reverseCogs(tx: any, order: OrderRef, source: CogsSource, lines: GoodsLine[], date: Date): Promise<number> {
  const back = Math.min(await costOfGoods(tx, lines), await cogsOnOrder(tx, order.id));
  if (!(back > 0)) return 0;
  await writeCogs(tx, order, source, -back, date);
  return back;
}
