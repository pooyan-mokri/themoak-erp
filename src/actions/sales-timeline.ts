'use server';

import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/access';
import { orderNet } from '@/lib/order-balance';

export type SaleChannel = 'site' | 'woo' | 'shop';

/**
 * Every sale that was not cancelled between two moments: when it was placed, its
 * amount and where it came from — the same orders and amounts as getSalesOverTime.
 * Read-only; the reports overview draws its trend, comparison and hour-by-weekday
 * grid from it.
 */
export async function getSalesTimeline(startDate: Date, endDate: Date) {
  await requirePermission('sales.view');
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      status: { not: 'CANCELLED' },
    },
    select: { createdAt: true, totalAmount: true, discount: true, siteReference: true, wooId: true },
    orderBy: { createdAt: 'asc' },
  });
  type Row = { createdAt: Date; totalAmount: unknown; discount: unknown; siteReference: string | null; wooId: number | null };
  return (orders as Row[]).map((order) => ({
    at: order.createdAt,
    // What the customer pays, after the discount (src/lib/order-balance.ts), as getSalesOverTime counts it.
    amount: orderNet(order),
    // The orders list names the source the same way: the site, the old WooCommerce store, or the shop.
    channel: (order.siteReference ? 'site' : order.wooId ? 'woo' : 'shop') as SaleChannel,
  }));
}
