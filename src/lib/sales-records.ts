import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';

/**
 * Helpers for the sales actions that must not be server actions themselves:
 * none of them checks a permission, so their callers do.
 */

/** Order money lands on a real-money account (as the POS and payment pickers offer). */
export const PAYMENT_ACCOUNT_TYPE_MESSAGE = 'حساب دریافت وجه باید از نوع بانک یا صندوق باشد.';

/**
 * Book one payment (in Toman) against an order's remaining debt, inside the
 * caller's transaction `tx`. recordOrderPayment and recordInvoicePayment both
 * use it, so a payment is booked once whichever screen it is entered on.
 *
 * The order row is locked first: two payments on the same order run one after
 * the other, and the second re-checks the debt the first one left. A request
 * id that was already booked answers 'duplicate' and writes nothing.
 * A refused payment throws, with the reason in Persian.
 */
export async function bookOrderPayment(
  tx: any,
  payment: {
    orderId: string;
    accountId: string;
    amount: number;
    requestId?: string | null;
    description?: string;
    receiptUrl?: string;
  },
): Promise<'booked' | 'duplicate'> {
  const { orderId, accountId, amount, requestId } = payment;

  const locked = await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (locked.length === 0) throw new Error('سفارش یافت نشد.');
  if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
    return 'duplicate';
  }

  const order = await tx.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  // Website orders are paid and refunded on the website.
  if (order.siteReference !== null) throw new Error(WEBSITE_ORDER_LOCKED);
  if (order.status === 'CANCELLED') throw new Error('این سفارش لغو شده است و نمی‌توان برای آن پرداخت ثبت کرد.');

  const totalAmount = Number(order.totalAmount) - Number(order.discount);
  const remainingDebt = totalAmount - Number(order.paidAmount);
  if (amount > remainingDebt) {
    throw new Error(`مبلغ پرداخت نمی‌تواند بیشتر از بدهی باقیمانده (${remainingDebt.toLocaleString()} تومان) باشد.`);
  }

  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('حساب دریافت وجه یافت نشد.');
  // cancelOrder takes back what a row added only on real-money accounts.
  if (account.type !== 'BANK' && account.type !== 'CASH') throw new Error(PAYMENT_ACCOUNT_TYPE_MESSAGE);
  // The payment is in Toman; a foreign-currency account moves by amount ÷ rate.
  const converted = await inAccountCurrency(tx, account, amount);
  const amountInAccountCurrency = new Prisma.Decimal(converted.amount);

  await tx.transaction.create({
    data: {
      amount: amountInAccountCurrency,
      currency: account.currency,
      rateSnapshot: new Prisma.Decimal(converted.rate),
      amountInToman: new Prisma.Decimal(amount),
      type: 'INCOME',
      accountId,
      customerId: order.customerId ?? undefined,
      orderId,
      clientRequestId: requestId ?? undefined,
      description: payment.description ?? `دریافت بابت سفارش #${order.number} - مشتری: ${order.customer?.name || 'مشتری'}`,
      category: 'Sales',
      date: new Date(),
      receiptUrl: payment.receiptUrl,
    },
  });

  await tx.account.update({
    where: { id: accountId },
    data: { balance: { increment: amountInAccountCurrency } },
  });

  await tx.order.update({
    where: { id: orderId },
    data: {
      paidAmount: { increment: new Prisma.Decimal(amount) },
      paymentStatus: Number(order.paidAmount) + amount >= totalAmount ? 'PAID' : 'PARTIAL',
    },
  });

  await syncInvoiceWithOrder(orderId, tx);
  return 'booked';
}

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
