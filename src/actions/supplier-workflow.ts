'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { TransactionType, ActionResult } from '@/lib/types';
import { z } from 'zod';
import { checkPermission } from '@/lib/access';
import { auth } from '@/auth';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { PURCHASE_ORDER_STATUS_LABELS, PURCHASE_ORDER_STATUS_SET_BY, canMovePurchaseOrder } from '@/lib/purchase-order-status';
import { readEntryDate } from '@/lib/entry-date';
import { owedTotalInToman } from '@/lib/landed-cost';
import { owedInTomanAfterCurrencyPayments } from '@/lib/purchase-order-balance';

/** A figure in the account's own unit, for balance messages. */
const inUnit = (amount: number, currency: string) =>
  `${amount.toLocaleString('fa-IR')} ${currency === 'TOMAN' ? 'تومان' : currency}`;

/** True when this submission's id is already on a booked row (a repeat that arrived after the first finished). */
async function alreadyBooked(tx: any, requestId: string | null): Promise<boolean> {
  return !!requestId && !!(await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }));
}

/**
 * Locks the purchase order, then the paying account, until the transaction
 * ends: a second submission for the same order waits, then reads it paid (or
 * its id already booked), and the balance check reads the balance it moves.
 */
async function lockOrderAndAccount(tx: any, orderId: string, accountId: string) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
}

/** Paid in Toman: the sum of an order's payments, whatever paid them. */
const paidOn = (order: { payments: Array<{ amount: unknown }> }) =>
  order.payments.reduce((sum: number, payment) => sum + Number(payment.amount), 0);

// Workflow Actions
/**
 * Moves an order along by hand. Cancelling an order that has payments moves what was paid on it (in Toman)
 * into the supplier's credit («طلب از تأمین‌کننده»), once: the order row is held for the transaction, so a
 * second cancel waits and then finds it cancelled, and the credit's key is unique per order.
 * expectedCredit is the amount the cancel confirmation named; if the payments changed since, nothing happens.
 */
export async function updatePurchaseOrderStatus(orderId: string, newStatus: string, expectedCredit?: number): Promise<ActionResult> {
  // Moving an order along is procurement work. Paid and received statuses are not set here at all.
  const denied = await checkPermission(['stock.manage', 'finance.manage']);
  if (denied) return denied;
  const session = await auth();
  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      // Hold the order: a payment, receipt or second move waits for this one, and this one reads what they wrote.
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { payments: { select: { amount: true } }, supplier: { select: { name: true } } },
      });

      if (!order) {
        return { refused: 'سفارش یافت نشد' };
      }

      // Validate status transition
      if (!canMovePurchaseOrder(order.status, newStatus)) {
        const label = (status: string) => PURCHASE_ORDER_STATUS_LABELS[status] ?? status;
        const setBy = PURCHASE_ORDER_STATUS_SET_BY[newStatus];
        return {
          refused: setBy
            ? `وضعیت «${label(newStatus)}» فقط با ${setBy} ثبت می‌شود و دستی تغییر نمی‌کند.`
            : `تغییر وضعیت از «${label(order.status)}» به «${label(newStatus)}» مجاز نیست`,
        };
      }

      const credit = newStatus === 'CANCELLED' ? paidOn(order) : 0;
      if (newStatus === 'CANCELLED' && expectedCredit !== undefined && Math.abs(expectedCredit - credit) >= 1) {
        return { refused: 'پرداخت‌های این سفارش از وقتی صفحه باز شد تغییر کرده است؛ صفحه را تازه کنید و دوباره لغو کنید.' };
      }

      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus }
      });
      if (credit > 0) {
        await tx.supplierCredit.create({
          data: {
            supplierId: order.supplierId,
            amount: credit,
            purchaseOrderId: orderId,
            reason: `لغو سفارش خرید #${order.number}`,
            userId: session?.user?.id ?? null,
            clientRequestId: `po-cancel:${orderId}`,
          },
        });
      }
      return { credit, supplierName: order.supplier.name as string };
    });
    if ('refused' in outcome) {
      return { success: false, message: outcome.refused };
    }

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/suppliers/management');
    return {
      success: true,
      message:
        outcome.credit > 0
          ? `سفارش لغو شد و ${Math.round(outcome.credit).toLocaleString('fa-IR')} تومان پرداخت‌شده به طلب از تأمین‌کننده «${outcome.supplierName}» اضافه شد.`
          : 'وضعیت سفارش به‌روزرسانی شد',
    };
  } catch (error: unknown) {
    console.error('Error updating purchase order status:', error);
    return { success: false, message: 'خطا در به‌روزرسانی وضعیت' };
  }
}

export async function recordPurchasePayment(orderId: string, accountId: string, requestId?: string): Promise<ActionResult> {
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;
  const clientRequestId = readRequestId(requestId);
  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      await lockOrderAndAccount(tx, orderId, accountId);
      if (await alreadyBooked(tx, clientRequestId)) return 'duplicate';
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true, additionalCosts: true }
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status !== 'PENDING_PAYMENT') {
        throw new Error('این سفارش در وضعیت پرداخت نیست');
      }

      // Check account exists and get balance
      const account = await tx.account.findUnique({
        where: { id: accountId }
      });

      if (!account) {
        throw new Error('حساب پرداخت یافت نشد');
      }

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        // Never silently fall back to 1 — this rate sizes a real cash movement.
        if (!rate) {
          throw new Error(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      // Calculate total amount in Toman
      let totalInToman = Number(order.totalAmountInToman) || 0;
      if (!totalInToman || totalInToman === 0) {
        // Recalculate if not set
        order.items.forEach((item: any) => {
          const rate = getExchangeRate(item.currency);
          totalInToman += Number(item.quantity) * Number(item.unitCost) * rate;
        });
        if (order.additionalCosts && order.additionalCosts.length > 0) {
          order.additionalCosts.forEach((cost: any) => {
            const rate = getExchangeRate(cost.currency);
            totalInToman += Number(cost.amount) * rate;
          });
        }
      }

      // The order is priced in Toman; the account pays in its own currency.
      const paid = await inAccountCurrency(tx, account, totalInToman);

      // Check if account has sufficient balance
      const accountBalance = Number(account.balance);
      if (accountBalance < paid.amount) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${inUnit(accountBalance, account.currency)}، مبلغ مورد نیاز: ${inUnit(paid.amount, account.currency)}`);
      }

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: paid.amount,
          currency: account.currency,
          rateSnapshot: paid.rate,
          amountInToman: totalInToman,
          accountId: accountId,
          description: `پرداخت سفارش خرید #${order.number} به تامین‌کننده`,
          category: 'Purchase Payment',
          date: new Date(),
          clientRequestId: clientRequestId ?? undefined,
        }
      });

      // Update account balance (decrement)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { decrement: paid.amount }
        }
      });

      // Record it as a payment too. The payments table is the single source of
      // truth for "how much has been paid" — without a row here a fully paid
      // order still reports zero paid and shows the whole amount as owing.
      await tx.purchaseOrderPayment.create({
        data: {
          purchaseOrderId: orderId,
          amount: totalInToman,
          accountId,
          transactionId: transaction.id,
          description: 'پرداخت کامل',
          date: new Date(),
        },
      });

      // Update order
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paymentAccountId: accountId,
          paymentTransactionId: transaction.id
        }
      });
      return 'booked';
    });
    if (outcome === 'duplicate') return { success: true, message: DUPLICATE_REQUEST_MESSAGE };

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/accounting/expenses');
    revalidatePath('/dashboard/accounting/transactions');
    return { success: true, message: 'پرداخت با موفقیت ثبت شد' };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error recording payment:', error);
    const message = error instanceof Error ? error.message : 'خطا در ثبت پرداخت';
    return { success: false, message };
  }
}

/**
 * Record a PARTIAL payment for a purchase order. Multiple payments are allowed,
 * each from a possibly different account, each on its own (Jalali) date.
 * Payments are made in Toman and are capped at the order's remaining balance;
 * the account pays the equivalent in its own currency.
 * When the running total reaches the order total, status becomes PAID; otherwise
 * it becomes PARTIALLY_PAID.
 */
export async function recordPurchasePartialPayment(input: {
  orderId: string;
  accountId: string;
  amount: number;        // in Toman
  date?: string;         // ISO string from the Jalali picker
  description?: string;
  /** One submission of the payment form (src/lib/request-id.ts). */
  requestId?: string;
}): Promise<ActionResult> {
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;
  const { orderId, accountId, amount, date, description } = input;
  const clientRequestId = readRequestId(input.requestId);

  if (!accountId) return { success: false, message: 'لطفا حساب پرداخت را انتخاب کنید.' };
  if (!amount || amount <= 0) return { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' };
  const paidOn = readEntryDate(date, 'پرداخت');
  if (!paidOn.ok) return { success: false, message: paidOn.error };

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      await lockOrderAndAccount(tx, orderId, accountId);
      if (await alreadyBooked(tx, clientRequestId)) return null;
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true, additionalCosts: true, payments: true },
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PARTIALLY_PAID') {
        throw new Error('این سفارش در وضعیت قابل پرداخت نیست');
      }

      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new Error('حساب پرداخت یافت نشد');

      // Exchange rates for recalculation fallback
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });
      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        // Never silently fall back to 1 — this rate sizes a real cash movement.
        if (!rate) {
          throw new Error(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      // Order total in Toman (recalculate if not stored)
      let totalInToman = Number(order.totalAmountInToman) || 0;
      if (!totalInToman) {
        order.items.forEach((item: any) => {
          totalInToman += Number(item.quantity) * Number(item.unitCost) * getExchangeRate(item.currency);
        });
        order.additionalCosts?.forEach((cost: any) => {
          totalInToman += Number(cost.amount) * getExchangeRate(cost.currency);
        });
      }

      // An order with a payment in the currency actually paid (payPurchaseOrder on the ERP API) owes what
      // remains of its own currency, at the latest rate (src/lib/purchase-order-balance.ts).
      const owed = owedInTomanAfterCurrencyPayments(order, getExchangeRate);
      if (owed !== null) totalInToman = owed;

      const paidSoFar = order.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const remaining = totalInToman - paidSoFar;

      if (remaining <= 0) {
        throw new Error('این سفارش قبلاً به‌طور کامل تسویه شده است.');
      }
      // Allow a tiny rounding tolerance, then cap at remaining
      if (amount > remaining + 1) {
        throw new Error(`مبلغ پرداخت از باقیمانده بیشتر است. باقیمانده: ${Math.round(remaining).toLocaleString('fa-IR')} تومان`);
      }
      const payAmount = amount > remaining ? remaining : amount;

      // The payment is in Toman; the account pays in its own currency.
      const paid = await inAccountCurrency(tx, account, payAmount);
      const balance = Number(account.balance);
      if (balance < paid.amount) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${inUnit(balance, account.currency)}، مبلغ مورد نیاز: ${inUnit(account.currency === 'TOMAN' ? Math.round(paid.amount) : paid.amount, account.currency)}`);
      }

      const paymentDate = paidOn.date;

      // 1. Expense transaction
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: paid.amount,
          currency: account.currency,
          rateSnapshot: paid.rate,
          amountInToman: payAmount,
          clientRequestId: clientRequestId ?? undefined,
          accountId,
          description: description?.trim()
            ? `پرداخت سفارش خرید #${order.number} - ${description.trim()}`
            : `پرداخت سفارش خرید #${order.number} به تامین‌کننده`,
          category: 'Purchase Payment',
          date: paymentDate,
        },
      });

      // 2. Decrement account balance
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: paid.amount } },
      });

      // 3. Payment record
      await tx.purchaseOrderPayment.create({
        data: {
          purchaseOrderId: orderId,
          amount: payAmount,
          accountId,
          transactionId: transaction.id,
          description: description?.trim() || null,
          date: paymentDate,
        },
      });

      // 4. Update order status + latest payment pointers
      const newPaid = paidSoFar + payAmount;
      const fullyPaid = newPaid >= totalInToman - 1; // rounding tolerance
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
          paymentAccountId: accountId,
          paymentTransactionId: transaction.id,
        },
      });

      return { fullyPaid, remaining: Math.max(0, totalInToman - newPaid) };
    });
    if (!result) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/accounting/expenses');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard', 'layout');

    return {
      success: true,
      message: result.fullyPaid
        ? 'پرداخت ثبت شد و سفارش به‌طور کامل تسویه شد.'
        : `پرداخت ثبت شد. باقیمانده: ${Math.round(result.remaining).toLocaleString('fa-IR')} تومان`,
    };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error recording partial payment:', error);
    const message = error instanceof Error ? error.message : 'خطا در ثبت پرداخت';
    return { success: false, message };
  }
}

// A refusal found inside a transaction: thrown so everything rolls back, then shown to the user as it is.
class CreditRefusal extends Error {}

/**
 * Pay an order (PENDING_PAYMENT or PARTIALLY_PAID) from its supplier's credit («طلب از تأمین‌کننده»): a payment
 * row with no account and no transaction, and a matching − row on the credit. At most min(credit, remaining),
 * the whole of it when no amount is given; a little over (1 toman, the payments' rounding) is capped. The order
 * and then its supplier are held, so two uses at once cannot both spend the same credit; one form submission
 * (requestId, stored on the credit row) pays once.
 */
export async function payPurchaseOrderFromCredit(input: {
  orderId: string;
  /** In Toman; the most the credit can pay when left out. */
  amount?: number;
  requestId?: string;
}): Promise<ActionResult> {
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;
  const { orderId, amount } = input;
  const clientRequestId = readRequestId(input.requestId);
  if (amount !== undefined && !(amount > 0)) return { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' };
  const session = await auth();

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
      if (clientRequestId && (await tx.supplierCredit.findUnique({ where: { clientRequestId }, select: { id: true } }))) {
        return null;
      }
      const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { payments: true, items: true, additionalCosts: true } });
      if (!order) throw new CreditRefusal('سفارش یافت نشد');
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PARTIALLY_PAID') {
        throw new CreditRefusal('این سفارش در وضعیت قابل پرداخت نیست');
      }
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${order.supplierId} FOR UPDATE`;

      const balance = Number(
        (await tx.supplierCredit.aggregate({ where: { supplierId: order.supplierId }, _sum: { amount: true } }))._sum.amount ?? 0,
      );
      let total = Number(order.totalAmountInToman) || 0;
      if (!total) {
        // Recorded in the supplier's currency, with no Toman total: priced at the latest rate, as the other payments price it.
        const rates = await tx.exchangeRate.findMany({ orderBy: { date: 'desc' }, distinct: ['currency'] });
        const rateOf = (currency: string) => {
          if (currency === 'TOMAN') return 1;
          const rate = rates.find((r: any) => r.currency === currency);
          if (!rate) throw new CreditRefusal(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
          return Number(rate.rateToToman);
        };
        // With a payment in the currency actually paid on it: what remains of its own currency, at the latest rate.
        total = owedInTomanAfterCurrencyPayments(order, rateOf) ?? owedTotalInToman(order, rateOf);
      }
      const paidSoFar = paidOn(order);
      const remaining = total - paidSoFar;
      if (balance <= 0) throw new CreditRefusal('از این تأمین‌کننده طلبی ثبت نشده است.');
      if (remaining <= 0) throw new CreditRefusal('این سفارش قبلاً به‌طور کامل تسویه شده است.');
      const cap = Math.min(balance, remaining);
      if (amount !== undefined && amount > cap + 1) {
        throw new CreditRefusal(`مبلغ از طلب قابل استفاده بیشتر است. حداکثر: ${Math.round(cap).toLocaleString('fa-IR')} تومان`);
      }
      const payAmount = amount === undefined ? cap : Math.min(amount, cap);

      await tx.purchaseOrderPayment.create({
        data: {
          purchaseOrderId: orderId,
          amount: payAmount,
          accountId: null,
          description: 'از طلب تأمین‌کننده',
          date: new Date(),
        },
      });
      await tx.supplierCredit.create({
        data: {
          supplierId: order.supplierId,
          amount: -payAmount,
          purchaseOrderId: orderId,
          reason: `پرداخت سفارش خرید #${order.number} از طلب`,
          userId: session?.user?.id ?? null,
          clientRequestId: clientRequestId ?? undefined,
        },
      });

      const newPaid = paidSoFar + payAmount;
      const fullyPaid = newPaid >= total - 1; // rounding tolerance, as for account payments
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID' },
      });
      return { payAmount, fullyPaid, remaining: Math.max(0, total - newPaid) };
    });
    if (!result) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/suppliers/management');
    const paid = `${Math.round(result.payAmount).toLocaleString('fa-IR')} تومان از طلب تأمین‌کننده پرداخت شد`;
    return {
      success: true,
      message: result.fullyPaid
        ? `${paid} و سفارش به‌طور کامل تسویه شد.`
        : `${paid}. باقیمانده: ${Math.round(result.remaining).toLocaleString('fa-IR')} تومان`,
    };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    if (error instanceof CreditRefusal) return { success: false, message: error.message };
    console.error('Error paying from supplier credit:', error);
    return { success: false, message: 'خطا در پرداخت از طلب تأمین‌کننده' };
  }
}

const arrivalCostsSchema = z.array(z.object({
  title: z.string().min(1, 'عنوان الزامی است'),
  amount: z.number().min(0, 'مبلغ باید بیشتر از ۰ باشد'),
  currency: z.enum(['TOMAN', 'USD', 'EUR', 'CNY']),
}));

export async function recordArrival(
  orderId: string,
  arrivalCosts: z.infer<typeof arrivalCostsSchema>,
  accountId: string,
  requestId?: string,
): Promise<ActionResult> {
  // Adds landed costs to the order and pays them from an account.
  const denied = (await checkPermission('cost.edit')) ?? (await checkPermission('finance.manage'));
  if (denied) return denied;
  const clientRequestId = readRequestId(requestId);
  try {
    const validatedCosts = arrivalCostsSchema.parse(arrivalCosts);

    const outcome = await prisma.$transaction(async (tx: any) => {
      await lockOrderAndAccount(tx, orderId, accountId);
      if (await alreadyBooked(tx, clientRequestId)) return 'duplicate';
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId }
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status !== 'IN_PRODUCTION') {
        throw new Error('این سفارش در وضعیت در حال تولید نیست');
      }

      // Check account exists and get balance
      const account = await tx.account.findUnique({
        where: { id: accountId }
      });

      if (!account) {
        throw new Error('حساب پرداخت هزینه‌های رسیدن به مقصد یافت نشد');
      }

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        // Never silently fall back to 1 — this rate sizes a real cash movement.
        if (!rate) {
          throw new Error(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      // Create arrival costs and transactions
      const arrivalCostsData = [];
      // Each cost in Toman, and what it takes from the account in the account's own currency.
      const costs = [];
      let totalFromAccount = 0;

      // First, calculate total costs to check balance
      for (const cost of validatedCosts) {
        const exchangeRate = getExchangeRate(cost.currency);
        const amountInToman = cost.amount * exchangeRate;
        const paid = await inAccountCurrency(tx, account, amountInToman);
        costs.push({ cost, exchangeRate, amountInToman, paid });
        totalFromAccount += paid.amount;
      }

      // Check if account has sufficient balance for all arrival costs
      const accountBalance = Number(account.balance);
      if (accountBalance < totalFromAccount) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${inUnit(accountBalance, account.currency)}، مبلغ مورد نیاز: ${inUnit(totalFromAccount, account.currency)}`);
      }

      // Now create transactions and arrival costs
      for (const [i, { cost, exchangeRate, amountInToman, paid }] of costs.entries()) {
        // Create transaction for this cost
        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            amount: paid.amount,
            currency: account.currency,
            rateSnapshot: paid.rate,
            amountInToman: amountInToman,
            accountId: accountId,
            description: `هزینه رسیدن به مقصد (${cost.title}) - سفارش خرید #${order.number}`,
            category: 'Purchase Arrival Cost',
            date: new Date(),
            // The submission's id goes on its first row.
            clientRequestId: i === 0 && clientRequestId ? clientRequestId : undefined,
          }
        });

        arrivalCostsData.push({
          title: cost.title,
          amount: cost.amount,
          currency: cost.currency,
          exchangeRateSnapshot: exchangeRate,
          amountInToman: amountInToman,
          transactionId: transaction.id,
        });
      }

      // Update account balance (decrement for each cost)
      // Note: We already checked balance above, so we can safely decrement
      if (totalFromAccount > 0) {
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: { decrement: totalFromAccount }
          }
        });
      }

      // Create arrival costs and update order
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'ARRIVED',
          arrivalAccountId: accountId,
          arrivalAdditionalCosts: {
            create: arrivalCostsData
          }
        }
      });
      return 'booked';
    });
    if (outcome === 'duplicate') return { success: true, message: DUPLICATE_REQUEST_MESSAGE };

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/accounting/expenses');
    revalidatePath('/dashboard/accounting/transactions');
    return { success: true, message: 'رسیدن به مقصد و هزینه‌های اضافی ثبت شد' };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error recording arrival:', error);
    if (error instanceof z.ZodError) {
      return { success: false, message: error.issues[0].message };
    }
    const message = error instanceof Error ? error.message : 'خطا در ثبت رسیدن به مقصد';
    return { success: false, message };
  }
}

