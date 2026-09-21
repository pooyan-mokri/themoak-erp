'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { getCurrentRole, hasPermission, requirePermission } from '@/lib/access';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { syncInvoiceWithOrder } from '@/lib/sales-records';
import { paymentStatusFor } from '@/lib/site-sale';
import {
  SITE_DECISION_KEPT,
  SITE_DECISION_RECEIVED,
  SITE_DECISION_REFUNDED,
  readSiteOrderData,
  unrealPayment,
  type SiteStatusEvent,
} from '@/lib/site-sale-data';
import type { ActionResult } from '@/lib/types';

/**
 * Website money nobody has decided about yet. The website cancels an order
 * without saying what happened to the money, and until 1405/06 the ERP booked
 * test and hand-marked payments as income; both leave the ERP holding money
 * the bank may not. An order stays on this list until an admin records what
 * happened: the money went back (a refund out of the account it left from),
 * it stays (kept), or, for a sale recorded unpaid, it did arrive (a receipt).
 */

export type SiteReviewAction = 'refund' | 'kept' | 'receipt';

export type SiteReviewRow = {
  id: string;
  number: number;
  reference: string;
  customerName: string | null;
  issuedAt: string | null;
  cancelled: boolean;
  /** Why the order is listed, in words a person can act on. */
  reasons: string[];
  actions: SiteReviewAction[];
  gateway: string | null;
  trackId: string | null;
  /** The account the sale's income went into: the default for a refund. */
  saleAccountId: string | null;
  /** Toman figures; null without finance.view. */
  amounts: {
    /** What the site says was paid. */
    sitePaid: number;
    /** Refunds the site reported. */
    siteRefunded: number;
    /** What the ERP holds for the order (Order.paidAmount). */
    held: number;
    /** What the order still owes. */
    owed: number;
  } | null;
  /** Decisions already recorded here, e.g. a partial refund. */
  decisions: Array<{ status: string; at: string; amount: number | null; note: string | null }>;
};

const DECISIONS = [SITE_DECISION_REFUNDED, SITE_DECISION_KEPT, SITE_DECISION_RECEIVED];

const lastIndexOf = (history: SiteStatusEvent[], statuses: string[]) => {
  for (let i = history.length - 1; i >= 0; i--) if (statuses.includes(history[i].status)) return i;
  return -1;
};

export async function getSitePaymentsToReview(): Promise<SiteReviewRow[]> {
  await requirePermission('sales.view');
  const canSeeAmounts = await hasPermission('finance.view');

  // Candidates: cancelled with money held, or a payment that looks like a test
  // or has no gateway trace (unrealPayment's rule, repeated in SQL).
  const candidates = (await prisma.$queryRaw`
    SELECT id FROM "Order"
    WHERE "siteReference" IS NOT NULL AND (
      (status = 'CANCELLED' AND "paidAmount" > 0)
      OR (status <> 'CANCELLED' AND (
        coalesce("siteData"->'payment'->>'trackId', '') = ''
        OR "siteData"->'payment'->>'sandbox' = 'true'
        OR coalesce("siteData"->'payment'->>'gateway', '') ~* '(sandbox|test)'
      ))
    )`) as Array<{ id: string }>;
  if (candidates.length === 0) return [];

  const orders = await prisma.order.findMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    include: {
      customer: { select: { name: true } },
      transaction: { select: { accountId: true } },
      siteRefunds: { select: { amount: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows: SiteReviewRow[] = [];
  for (const order of orders) {
    const data = readSiteOrderData(order.siteData);
    if (!data) continue;
    const history = data.history ?? [];
    const cancelled = order.status === 'CANCELLED';
    const held = Number(order.paidAmount);
    const owed = Math.max(0, Number(order.totalAmount) - Number(order.discount) - held);
    const unreal = unrealPayment(data.payment);
    const payment =
      unreal === 'sandbox'
        ? 'پرداخت آزمایشی (sandbox)'
        : unreal === 'untraced'
          ? 'پرداخت بدون ردّ درگاه (trackId ندارد)'
          : null;
    // A decision holds until the site cancels the order after it.
    const lastCancel = lastIndexOf(history, ['cancelled']);
    const confirmed = lastIndexOf(history, [SITE_DECISION_KEPT, SITE_DECISION_RECEIVED]);
    const refunded = lastIndexOf(history, [SITE_DECISION_REFUNDED]);

    const reasons: string[] = [];
    const actions = new Set<SiteReviewAction>();
    if (cancelled) {
      if (held > 0 && confirmed <= lastCancel) {
        reasons.push('در سایت لغو شده ولی پول آن در ERP مانده و بازپرداختی ثبت نشده است.');
        if (payment) reasons.push(payment);
        actions.add('refund').add('kept');
      }
    } else if (payment) {
      if (held > 0 && confirmed < 0) {
        reasons.push(`${payment}، ولی به‌عنوان درآمد در حساب ثبت شده است.`);
        actions.add('refund').add('kept');
      }
      if (data.payment.amount > held && owed > 0 && refunded < 0) {
        reasons.push(`${payment}؛ درآمدی از آن ثبت نشده و سفارش پرداخت‌نشده مانده است.`);
        actions.add('receipt');
      }
    }
    if (reasons.length === 0) continue;

    rows.push({
      id: order.id,
      number: order.number,
      reference: order.siteReference as string,
      customerName: order.customer?.name ?? data.customer?.name ?? null,
      issuedAt: data.issuedAt ?? null,
      cancelled,
      reasons,
      actions: Array.from(actions),
      gateway: data.payment.gateway,
      trackId: data.payment.trackId,
      saleAccountId: order.transaction?.accountId ?? null,
      amounts: canSeeAmounts
        ? {
            sitePaid: data.payment.amount,
            siteRefunded: order.siteRefunds.reduce((sum: number, r: any) => sum + Number(r.amount), 0),
            held,
            owed,
          }
        : null,
      decisions: history
        .filter((event) => DECISIONS.includes(event.status))
        .map((event) => ({
          status: event.status,
          at: event.at,
          amount: canSeeAmounts ? event.amount : null,
          note: event.note ?? null,
        })),
    });
  }
  return rows;
}

// ── Decisions (ADMIN) ───────────────────────────────────────────────────────

const fa = (n: number) => n.toLocaleString('fa-IR');

async function requireAdmin(): Promise<ActionResult | null> {
  if ((await getCurrentRole()) !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.' };
  }
  return null;
}

/** The website order, locked until the transaction ends, with what the site sent. */
async function lockedSiteOrder(tx: any, orderId: string) {
  const locked = await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (locked.length === 0) throw new Error('سفارش یافت نشد.');
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { invoice: { select: { id: true } } } });
  const data = order.siteReference ? readSiteOrderData(order.siteData) : null;
  if (!data) throw new Error('این سفارش از سایت نیامده است.');
  return { order, data };
}

function decision(
  status: string,
  fields: { amount: number | null; note: string; by: string | null; accountId?: string; transactionId?: string },
): SiteStatusEvent {
  const now = new Date().toISOString();
  return {
    status,
    at: now,
    receivedAt: now,
    trackingCode: null,
    amount: fields.amount,
    restock: null,
    refundId: null,
    note: fields.note,
    by: fields.by,
    accountId: fields.accountId ?? null,
    transactionId: fields.transactionId ?? null,
  };
}

function revalidate(orderId: string) {
  revalidatePath('/dashboard/sales/site-review');
  revalidatePath('/dashboard/sales/history');
  revalidatePath(`/dashboard/sales/history/${orderId}`);
  revalidatePath('/dashboard/accounting/transactions');
}

type MoneyDecision = { orderId: string; accountId: string; amount: number; note: string; requestId?: string };

/**
 * Money of a website order moved in the ERP: a refund out of the chosen
 * account, or a receipt into it. One row linked to the order, in the account's
 * own currency; the order's paid amount follows.
 */
async function bookSiteMoney(input: MoneyDecision, direction: 'refund' | 'receipt'): Promise<ActionResult> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, message: 'مبلغ باید بیشتر از صفر باشد.' };
  const note = (input.note ?? '').trim();
  if (!note) return { success: false, message: 'توضیح الزامی است.' };
  if (!input.accountId) return { success: false, message: 'حساب را انتخاب کنید.' };
  const requestId = readRequestId(input.requestId);
  const by = (await auth())?.user?.id ?? null;
  const refund = direction === 'refund';

  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      const { order, data } = await lockedSiteOrder(tx, input.orderId);
      // A repeat of a submission that already went through (the order lock makes it wait for it).
      if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
        return 'duplicate';
      }
      const discount = Number(order.discount);
      let paid = Number(order.paidAmount);
      let totalAmount = Number(order.totalAmount);
      if (refund && amount > paid) {
        throw new Error(`مبلغ بازپرداخت از پولی که ERP از این سفارش نگه داشته (${fa(paid)} تومان) بیشتر است.`);
      }
      if (!refund) {
        if (order.status === 'CANCELLED') throw new Error('این سفارش لغو شده است؛ برای آن دریافت ثبت نمی‌شود.');
        const owed = totalAmount - discount - paid;
        if (amount > owed) throw new Error(`مبلغ دریافت از ماندهٔ سفارش (${fa(Math.max(0, owed))} تومان) بیشتر است.`);
      }

      const [account] = await tx.$queryRaw`
        SELECT id, name, type, currency FROM "Account" WHERE id = ${input.accountId} FOR UPDATE`;
      if (!account) throw new Error('حساب یافت نشد.');
      if (account.type === 'EXPENSE') {
        throw new Error('حساب هزینه پول نقد ندارد؛ حساب بانکی یا صندوقی را انتخاب کنید که پول واقعاً از آن رفت یا به آن آمد.');
      }
      const converted = await inAccountCurrency(tx, account, amount);
      const row = await tx.transaction.create({
        data: {
          type: refund ? 'EXPENSE' : 'INCOME',
          category: refund ? 'Return' : 'Sales',
          accountId: account.id,
          amount: new Prisma.Decimal(converted.amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(converted.rate),
          amountInToman: new Prisma.Decimal(amount),
          customerId: order.customerId ?? undefined,
          orderId: order.id,
          clientRequestId: requestId ?? undefined,
          date: new Date(),
          description: `${refund ? 'بازپرداخت' : 'دریافت پول'} سفارش سایت ${order.siteReference} (ثبت در ERP) - ${note}`,
          tags: ['website'],
        },
      });
      await tx.account.update({
        where: { id: account.id },
        data: {
          balance: refund
            ? { decrement: new Prisma.Decimal(converted.amount) }
            : { increment: new Prisma.Decimal(converted.amount) },
        },
      });

      if (refund) {
        paid -= amount;
        // A void sale owes nothing. A live one is back to where it was before
        // the money was booked: owed, until it is paid or the site cancels it.
        if (order.status === 'CANCELLED') totalAmount = discount + paid;
      } else {
        paid += amount;
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          paidAmount: paid,
          totalAmount,
          paymentStatus: paymentStatusFor(totalAmount - discount, paid),
          // A sale with no income row yet: the site's refunds come out of this account.
          ...(!refund && !order.transactionId ? { transactionId: row.id } : {}),
          siteData: {
            ...data,
            history: [
              ...data.history,
              decision(refund ? SITE_DECISION_REFUNDED : SITE_DECISION_RECEIVED, {
                amount,
                note,
                by,
                accountId: account.id,
                transactionId: row.id,
              }),
            ],
          },
        },
      });
      if (order.invoice) await syncInvoiceWithOrder(order.id, tx);
      return 'booked';
    });
    if (outcome === 'duplicate') return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error recording website order money:', error);
    return { success: false, message: error instanceof Error ? error.message : 'خطا در ثبت.' };
  }

  revalidate(input.orderId);
  return {
    success: true,
    message: refund ? 'بازپرداخت ثبت شد و از حساب کم شد.' : 'دریافت پول ثبت شد و به حساب اضافه شد.',
  };
}

/** A website order's money went back to the customer, or never arrived: out of the chosen account. */
export async function recordSiteOrderRefund(input: MoneyDecision): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;
  return bookSiteMoney(input, 'refund');
}

/** The money of a website sale recorded unpaid did arrive: into the chosen account. */
export async function recordSiteOrderReceipt(input: MoneyDecision): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;
  return bookSiteMoney(input, 'receipt');
}

/** The money the ERP holds for a website order stays, for the reason given: no refund. */
export async function markSiteOrderKept(input: { orderId: string; note: string }): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const note = (input.note ?? '').trim();
  if (!note) return { success: false, message: 'توضیح الزامی است.' };
  const by = (await auth())?.user?.id ?? null;

  try {
    await prisma.$transaction(async (tx: any) => {
      const { order, data } = await lockedSiteOrder(tx, input.orderId);
      const held = Number(order.paidAmount);
      if (held <= 0) throw new Error('پولی از این سفارش در ERP نمانده است.');
      await tx.order.update({
        where: { id: order.id },
        data: { siteData: { ...data, history: [...data.history, decision(SITE_DECISION_KEPT, { amount: held, note, by })] } },
      });
    });
  } catch (error: unknown) {
    console.error('Error marking website order money as kept:', error);
    return { success: false, message: error instanceof Error ? error.message : 'خطا در ثبت.' };
  }

  revalidate(input.orderId);
  return { success: true, message: 'ثبت شد: پول این سفارش نگه داشته می‌شود.' };
}
