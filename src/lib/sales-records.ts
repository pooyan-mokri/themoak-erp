import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { orderNet } from '@/lib/order-balance';
import { creditUsable } from '@/lib/return-math';

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

  const totalAmount = orderNet(order);
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

/** Why a row of a customer's credit account was written (CustomerCredit.reason). */
export const CREDIT_REASON = {
  /** An exchange's difference the customer left with the shop. */
  EXCHANGE: 'EXCHANGE',
  /** Credit spent on an order. */
  PAYMENT: 'PAYMENT',
  /** A cancelled order's spent credit, given back. */
  CANCEL: 'CANCEL',
} as const;

/** A customer's credit balance: the sum of their CustomerCredit rows, in Toman. */
export async function creditBalance(client: any, customerId: string): Promise<number> {
  const sum = await client.customerCredit.aggregate({ where: { customerId }, _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
}

/** The credit balance of every customer who has one, by customer id. */
export async function creditBalances(client: any = prisma): Promise<Map<string, number>> {
  const rows = await client.customerCredit.groupBy({ by: ['customerId'], _sum: { amount: true } });
  return new Map(rows.map((row: any) => [row.customerId, Number(row._sum.amount ?? 0)]));
}

/**
 * Serializes every use of one customer's credit until the transaction ends, so
 * a second use sees the balance the first one left.
 */
export async function lockCustomerCredit(tx: any, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-credit:${customerId}`}))`;
}

/** Credit spent on an order and not given back: what a cancel of it returns to the customer. */
export async function creditSpentOn(client: any, orderId: string): Promise<number> {
  const sum = await client.customerCredit.aggregate({
    where: { orderId, reason: { in: [CREDIT_REASON.PAYMENT, CREDIT_REASON.CANCEL] } },
    _sum: { amount: true },
  });
  return -Number(sum._sum.amount ?? 0);
}

const toman = (amount: number) => Math.round(amount).toLocaleString('fa-IR');

/** The most of `customerId`'s credit an order still owing `remaining` may use, or a Persian refusal. */
export async function checkCreditUse(tx: any, customerId: string, amount: number, remaining: number) {
  const usable = creditUsable(await creditBalance(tx, customerId), remaining);
  if (!(amount > 0)) throw new Error('مبلغ استفاده از اعتبار باید بیشتر از صفر باشد.');
  if (amount > usable + 0.01) {
    throw new Error(`از اعتبار مشتری حداکثر ${toman(usable)} تومان برای این سفارش قابل استفاده است.`);
  }
}

/**
 * Pay `amount` of an order from its customer's credit, inside the caller's
 * transaction `tx`: no money row and no account moves; the order's paid amount
 * grows and a negative CustomerCredit row records the use. At most the
 * customer's balance and at most what the order still owes.
 *
 * The order is locked first, then the customer's credit, the order every
 * writer takes them in. A request id that was already booked answers
 * 'duplicate' and writes nothing. A refused use throws, with the reason in Persian.
 */
export async function bookCreditPayment(
  tx: any,
  use: { orderId: string; amount: number; requestId?: string | null; userId?: string | null },
): Promise<'booked' | 'duplicate'> {
  const { orderId, amount, requestId } = use;
  const locked = await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (locked.length === 0) throw new Error('سفارش یافت نشد.');
  if (requestId && (await tx.customerCredit.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
    return 'duplicate';
  }

  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (order.siteReference !== null) throw new Error(WEBSITE_ORDER_LOCKED);
  if (order.status === 'CANCELLED') throw new Error('این سفارش لغو شده است و نمی‌توان برای آن پرداخت ثبت کرد.');
  if (!order.customerId) throw new Error('این سفارش مشتری ندارد؛ اعتبار فقط روی سفارش مشتری قابل استفاده است.');

  await lockCustomerCredit(tx, order.customerId);
  const net = orderNet(order);
  await checkCreditUse(tx, order.customerId, amount, net - Number(order.paidAmount));

  await tx.customerCredit.create({
    data: {
      customerId: order.customerId,
      amount: new Prisma.Decimal(-amount),
      orderId,
      reason: CREDIT_REASON.PAYMENT,
      userId: use.userId ?? undefined,
      clientRequestId: requestId ?? undefined,
    },
  });
  await tx.order.update({
    where: { id: orderId },
    data: {
      paidAmount: { increment: new Prisma.Decimal(amount) },
      paymentStatus: Number(order.paidAmount) + amount >= net - 0.5 ? 'PAID' : 'PARTIAL',
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
    select: { totalAmount: true, discount: true, paidAmount: true, wooId: true, siteReference: true },
  });
  if (!order) return;

  const subtotal = Number(order.totalAmount);
  const discount = Number(order.discount);
  const tax = Number(invoice.tax);
  // Never negative (src/lib/order-balance.ts).
  const total = orderNet(order) + tax;
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
