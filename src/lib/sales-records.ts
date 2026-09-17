import { prisma } from '@/lib/prisma';

/**
 * Helpers for the sales actions that must not be server actions themselves:
 * none of them checks a permission, so their callers do.
 */

/**
 * Resync an existing invoice to its order's current totals.
 * Used after a return / exchange has changed Order.totalAmount or
 * Order.paidAmount so the invoice doesn't keep showing pre-return values.
 *
 * Pass a Prisma transaction client (`tx`) to run inside an existing
 * transaction; otherwise it runs against the global prisma client.
 *
 * Silently no-ops when the order has no invoice.
 *
 * The website's sale path (/api/erp: a bearer key, no session) calls it too.
 */
export async function syncInvoiceWithOrder(orderId: string, client: any = prisma) {
  const invoice = await client.invoice.findUnique({ where: { orderId } });
  if (!invoice) return;

  const order = await client.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true, discount: true, paidAmount: true },
  });
  if (!order) return;

  const subtotal = Number(order.totalAmount);
  const discount = Number(order.discount);
  const tax = Number(invoice.tax);
  const total = subtotal - discount + tax;
  const paidAmount = Number(order.paidAmount);

  let status: string = 'PAID';
  if (paidAmount < total) {
    status = paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
  }
  if (status !== 'PAID' && new Date(invoice.dueDate) < new Date()) {
    status = 'OVERDUE';
  }

  await client.invoice.update({
    where: { id: invoice.id },
    data: { subtotal, discount, total, paidAmount, status },
  });
}

/** A product row as a number-typed object, without costPrice unless the viewer holds cost.view. */
export function productForViewer(product: any, canSeeCost: boolean) {
  const { costPrice, ...rest } = product;
  return {
    ...rest,
    ...(canSeeCost ? { costPrice: Number(costPrice) } : {}),
    sellPrice: Number(product.sellPrice),
    image: product.image ?? undefined,
    wooId: product.wooId ?? undefined,
    barcode: product.barcode ?? undefined,
  };
}

/** An account row without its balance unless the viewer holds finance.view. */
export function accountForViewer(account: any, canSeeBalance: boolean) {
  const { balance, ...rest } = account;
  return canSeeBalance ? { ...rest, balance: Number(balance) } : rest;
}
