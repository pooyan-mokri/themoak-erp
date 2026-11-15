/**
 * Paying purchase orders on the ERP API (/api/erp), in the currency actually paid: payPurchaseOrder and
 * addPurchaseOrderCost. The owner's full key only; a personal key and the website's key get 403.
 *
 * A purchase order made through the API is recorded as the supplier's PI states it (yuan, no Toman figure,
 * src/lib/erp-api-purchasing.ts). Its Toman value is decided here, payment by payment:
 *
 *   paid          amount of `currency`, as it reached the supplier        ¥2,000
 *   accountAmount what left the account, in the account's own currency    2000 / 6.6703 = $299.84
 *   Toman value   accountAmount × tomanRate                               299.84 × 271,000 = 81,256,640
 *
 * accountRate is the bank's rate between the two: units of `currency` per 1 unit of the account's currency
 * (6.6703 yuan per dollar), so accountAmount = amount / accountRate. From a Toman account it is quoted the usual
 * way round, Toman per 1 unit of `currency`, so accountAmount = amount × accountRate. Paid in the account's own
 * currency there is no rate. tomanRate is Toman per 1 unit of the account's currency: given, or the currency's
 * latest rate; 1 for a Toman account.
 *
 * The order's balance is kept in the order's currency (src/lib/purchase-order-balance.ts says what each payment
 * settles). When it reaches 0 the order is PAID and its Toman snapshots are set from what was actually paid:
 *
 *   totalAmountInToman = Σ its payments' Toman values
 *   effective rate     = totalAmountInToman / total in the order's currency
 *   every line:  exchangeRateSnapshot = rate, unitCostInToman = unitCost × rate
 *   every cost:  exchangeRateSnapshot = rate, amountInToman   = amount × rate
 *
 * so receiving costs each unit at the rate really paid (src/lib/landed-cost.ts). A line's totalCostInToman is
 * left alone: receiving adds each receipt's landed cost to it (src/actions/supplier.ts), so a figure put there
 * at payment would be counted twice.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { logActivity } from '@/lib/activity-log';
import { latestRates } from '@/lib/money-totals';
import { PURCHASE_ORDER_STATUS_LABELS } from '@/lib/purchase-order-status';
import { BALANCE_TOLERANCE, orderBalance, orderCurrencyOf, orderTotalOf } from '@/lib/purchase-order-balance';
import { isDuplicateRequest, readRequestId } from '@/lib/request-id';

export const PO_PAYMENT_POST_ACTIONS = ['payPurchaseOrder', 'addPurchaseOrderCost'];

const CURRENCIES = ['TOMAN', 'USD', 'EUR', 'CNY'];
const CURRENCY_NAMES: Record<string, string> = { TOMAN: 'تومان', USD: 'دلار', EUR: 'یورو', CNY: 'یوان' };
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', CNY: '¥' };

/** Paid here: placed and still owing. A draft is placed by its first payment. */
const PAYABLE = ['DRAFT', 'PENDING_PAYMENT', 'PARTIALLY_PAID'];
/**
 * Past payment and not yet received: a cost added then (addPurchaseOrderCost) is paid here too, and the order
 * stays where it is; its status never moves back from production or arrival.
 */
const PAYABLE_IN_PLACE = ['IN_PRODUCTION', 'ARRIVED'];
/** No cost is added once goods have come in (their landed cost is booked) or the order is cancelled. */
const NO_NEW_COST = ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

type Reply = { status: number; body: any };
const ok = (body: any): Reply => ({ status: 200, body: { success: true, ...body } });
const refuse = (error: string, extra: Record<string, unknown> = {}): Reply => ({ status: 422, body: { error, ...extra } });
class Refusal extends Error {
  constructor(message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const number = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
const given = (v: unknown) => v !== undefined && v !== null && v !== '';
const round2 = (n: number) => Math.round(n * 100) / 100;
/** An amount as it is written on a bank slip: ¥2,000 · $299.84 · 81,256,640 تومان. */
export const money = (amount: number, currency: string) => {
  const figure = amount.toLocaleString('en-US', { maximumFractionDigits: currency === 'TOMAN' ? 0 : 2 });
  return currency === 'TOMAN' ? `${figure} تومان` : `${SYMBOLS[currency] ?? ''}${figure}`;
};
/** What an account holds or moves: whole Toman, cents of anything else. */
const inAccountUnit = (amount: number, currency: string) => (currency === 'TOMAN' ? Math.round(amount) : round2(amount));

function positive(value: unknown, name: string, what: string): number {
  const n = number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Refusal(`${what} (${name}) باید عددی بیشتر از صفر باشد.`);
  return n;
}

/** A Gregorian day, today when none is given. A Jalali «1405-06-30» would be stored as the year 1405. */
function readDate(value: unknown): Date {
  if (!given(value)) return new Date();
  if (typeof value !== 'string') throw new Refusal('تاریخ (date) باید میلادی و به شکل YYYY-MM-DD باشد.');
  if (/^\s*1[34]\d\d(\D|$)/.test(value)) throw new Refusal(`تاریخ «${value}» شمسی به نظر می‌رسد؛ تاریخ میلادی بفرستید، مثلاً 2026-11-15.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) throw new Refusal(`تاریخ «${value}» معتبر نیست؛ به شکل YYYY-MM-DD بفرستید.`);
  return date;
}

/** The order by its number: 8, "8", "PO-8" or "#8". */
async function orderIdFor(client: any, ref: unknown): Promise<{ id: string; number: number }> {
  const raw = text(ref).replace(/^(po[-\s]?|#)/i, '');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) throw new Refusal('شمارهٔ سفارش خرید (order) لازم است، مثلاً 8.');
  const order = await client.purchaseOrder.findFirst({ where: { number: n }, select: { id: true, number: true } });
  if (!order) throw new Refusal(`سفارش خرید PO-${n} پیدا نشد.`);
  return order;
}

/** The paying account by its id or its name; part of a name is enough when only one account has it. */
async function accountIdFor(client: any, ref: unknown): Promise<string> {
  const key = text(ref);
  if (!key) throw new Refusal('حساب پرداخت (account) را با نام یا شناسه بگویید.');
  const rows = await client.account.findMany({
    where: { OR: [{ id: key }, { name: { contains: key, mode: 'insensitive' } }] },
    select: { id: true, name: true, currency: true },
    take: 6,
  });
  const exact = rows.find((a: any) => a.id === key || a.name.trim().toLowerCase() === key.toLowerCase());
  if (exact) return exact.id;
  if (rows.length === 1) return rows[0].id;
  throw new Refusal(
    rows.length ? `«${key}» به چند حساب می‌خورد؛ نام کامل یا شناسه را بگویید.` : `حساب «${key}» پیدا نشد.`,
    rows.length ? { options: rows.map((a: any) => ({ id: a.id, name: a.name, currency: a.currency })) } : {},
  );
}

const ORDER_PARTS = {
  supplier: { select: { name: true } },
  items: { orderBy: { id: 'asc' as const } },
  additionalCosts: true,
  payments: true,
};

/** Toman per unit of a currency, latest; 0 when none is recorded. */
async function rateReader(tx: any) {
  const rates = await latestRates(tx);
  return (currency: string) => (currency === 'TOMAN' ? 1 : Number(rates.find((r: any) => r.currency === currency)?.rateToToman ?? 0));
}

/** One payment as the API answers it. */
const paymentReply = (p: any, accountCurrency: string | null) => ({
  id: p.id,
  date: p.date,
  paidAmount: p.paidAmount == null ? null : Number(p.paidAmount),
  currency: p.paidCurrency ?? null,
  accountAmount: p.accountAmount == null ? null : Number(p.accountAmount),
  accountCurrency,
  accountRate: p.accountRate == null ? null : Number(p.accountRate),
  tomanRate: p.tomanRate == null ? null : Number(p.tomanRate),
  amountInToman: Number(p.amount),
  inOrderCurrency: p.orderAmount == null ? null : Number(p.orderAmount),
  note: p.description ?? null,
});

/** The order's state as both actions answer it: status, and its balance in its own currency. */
function orderReply(order: any, rateOf: (currency: string) => number) {
  const balance = orderBalance(order, rateOf);
  return {
    order: order.number,
    supplier: order.supplier?.name,
    status: order.status,
    statusLabel: PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status,
    currency: balance?.currency ?? null,
    totalAmount: balance?.total ?? Number(order.totalAmount),
    paidInOrderCurrency: balance?.paid ?? null,
    remainingInOrderCurrency: balance?.remaining ?? null,
    totalAmountInToman: order.totalAmountInToman == null ? null : Number(order.totalAmountInToman),
  };
}

/**
 * Sets a foreign-currency order's Toman snapshots from what was actually paid (see the top of this file). Called
 * when the order's balance reaches 0, with its payments as they now are.
 */
async function fixTomanSnapshots(tx: any, order: any, total: number, paidInToman: Decimal) {
  if (!(total > 0)) return;
  const rate = paidInToman.div(total);
  for (const item of order.items) {
    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { exchangeRateSnapshot: rate, unitCostInToman: new Decimal(item.unitCost).times(rate) },
    });
  }
  for (const cost of order.additionalCosts) {
    await tx.purchaseOrderAdditionalCost.update({
      where: { id: cost.id },
      data: { exchangeRateSnapshot: rate, amountInToman: new Decimal(cost.amount).times(rate) },
    });
  }
  await tx.purchaseOrder.update({ where: { id: order.id }, data: { totalAmountInToman: paidInToman } });
}

/**
 * Records one payment on a purchase order, in the currency actually paid, from an account in any currency: an
 * expense row and the account's balance in the account's currency, the payment with what was paid and at which
 * rates, and the order's status. One database transaction; the order and then the account are held for it, as
 * recordPurchasePartialPayment holds them, so two payments on one order take turns. A call repeated with the same
 * requestId is answered with the payment it already made.
 */
export async function payPurchaseOrder(client: any, fields: any): Promise<Reply> {
  try {
    const amount = positive(fields.amount, 'amount', 'مبلغ پرداخت');
    const currency = text(fields.currency).toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new Refusal(`ارز پرداخت (currency) لازم است: ${CURRENCIES.join('، ')} — ارزی که واقعاً پرداخت شده.`);
    const accountRate = given(fields.accountRate) ? positive(fields.accountRate, 'accountRate', 'نرخ بانک') : null;
    const givenTomanRate = given(fields.tomanRate) ? positive(fields.tomanRate, 'tomanRate', 'نرخ تومان') : null;
    const date = readDate(fields.date);
    const note = text(fields.note) || null;
    const requestId = readRequestId(fields.requestId);
    if (!requestId && given(fields.requestId)) throw new Refusal('requestId باید ۸ تا ۶۴ حرف، رقم، - یا _ باشد؛ یا آن را نفرستید.');

    const found = await orderIdFor(client, fields.order ?? fields.orderNumber ?? fields.number);
    const accountId = await accountIdFor(client, fields.account ?? fields.accountId);

    /** The answer to a requestId already stored: the payment it made, and the order and account as they are now. */
    const repeated = async (db: any) => {
      const payment = await db.purchaseOrderPayment.findUnique({
        where: { clientRequestId: requestId },
        include: { account: { select: { id: true, name: true, currency: true, balance: true } } },
      });
      const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: payment.purchaseOrderId }, include: ORDER_PARTS });
      return {
        duplicate: true,
        message: 'این پرداخت قبلاً با همین requestId ثبت شده است؛ چیزی دوباره ثبت نشد.',
        ...orderReply(order, await rateReader(db)),
        payment: paymentReply(payment, payment.account?.currency ?? null),
        account: payment.account && { id: payment.account.id, name: payment.account.name, currency: payment.account.currency, balance: Number(payment.account.balance) },
      };
    };

    let result: any;
    try {
      result = await client.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${found.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
        if (requestId && (await tx.purchaseOrderPayment.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
          return repeated(tx);
        }

        const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: found.id }, include: ORDER_PARTS });
        const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
        const label = PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status;
        if (!PAYABLE.includes(order.status) && !PAYABLE_IN_PLACE.includes(order.status)) {
          throw new Refusal(`سفارش خرید PO-${order.number} در وضعیت «${label}» است و پرداخت نمی‌گیرد.`, { status: order.status });
        }
        const orderCurrency = orderCurrencyOf(order);
        if (!orderCurrency) throw new Refusal(`اقلام و هزینه‌های سفارش خرید PO-${order.number} چند ارز دارند؛ پرداختش را در صفحهٔ سفارش ثبت کنید.`);

        // What leaves the account, in the account's own currency.
        const acct: string = account.currency;
        let accountAmount = amount;
        if (currency !== acct) {
          if (accountRate === null) {
            throw new Refusal(
              acct === 'TOMAN'
                ? `پرداخت ${CURRENCY_NAMES[currency]} از حساب تومانی «${account.name}»: نرخ بانک (accountRate) لازم است، چند تومان برای هر ${CURRENCY_NAMES[currency]}.`
                : `پرداخت ${CURRENCY_NAMES[currency]} از حساب ${CURRENCY_NAMES[acct]} «${account.name}»: نرخ بانک (accountRate) لازم است، چند ${CURRENCY_NAMES[currency]} برای هر ${CURRENCY_NAMES[acct]}.`,
              { accountCurrency: acct },
            );
          }
          accountAmount = acct === 'TOMAN' ? amount * accountRate : amount / accountRate;
        }
        accountAmount = inAccountUnit(accountAmount, acct);
        if (!(accountAmount > 0)) throw new Refusal('این مبلغ با این نرخ در حساب به صفر می‌رسد؛ مبلغ و نرخ را بازبینی کنید.');

        // Its Toman value.
        const rateOf = await rateReader(tx);
        const tomanRate = acct === 'TOMAN' ? 1 : givenTomanRate ?? rateOf(acct);
        if (!(tomanRate > 0)) throw new Refusal(`نرخ ${CURRENCY_NAMES[acct]} به تومان ثبت نشده است؛ tomanRate را بفرستید یا نرخ روز را در ERP ثبت کنید.`);
        const amountInToman = Math.round(accountAmount * tomanRate);

        // What it settles of the order, in the order's currency (src/lib/purchase-order-balance.ts, rule 1).
        let orderAmount: number;
        if (currency === orderCurrency) orderAmount = amount;
        else if (acct === orderCurrency) orderAmount = accountAmount;
        else if (orderCurrency === 'TOMAN') orderAmount = amountInToman;
        else {
          const orderRate = rateOf(orderCurrency);
          if (!(orderRate > 0)) throw new Refusal(`سفارش به ${CURRENCY_NAMES[orderCurrency]} است و نرخ روز آن ثبت نشده؛ این پرداخت را نمی‌توان به ارز سفارش برگرداند.`);
          orderAmount = round2(amountInToman / orderRate);
        }

        const before = orderBalance(order, rateOf)!;
        // A Toman payment on an order with no Toman total is counted at the latest rate: without one, nothing adds up.
        if (order.payments.some((p: any) => p.orderAmount == null) && orderCurrency !== 'TOMAN' && !(Number(order.totalAmountInToman) > 0) && !(rateOf(orderCurrency) > 0)) {
          throw new Refusal(`این سفارش پرداخت تومانی دارد و نرخ روز ${CURRENCY_NAMES[orderCurrency]} ثبت نشده است؛ اول نرخ را در ERP ثبت کنید.`);
        }
        if (before.remaining <= 0) throw new Refusal(`سفارش خرید PO-${order.number} بدهی‌ای ندارد؛ کامل پرداخت شده است.`, { remainingInOrderCurrency: 0 });
        if (orderAmount > before.remaining + BALANCE_TOLERANCE) {
          throw new Refusal(
            `این پرداخت (${money(orderAmount, orderCurrency)}) از باقیماندهٔ سفارش خرید PO-${order.number} بیشتر است. باقیمانده: ${money(before.remaining, orderCurrency)}.`,
            { remainingInOrderCurrency: before.remaining, currency: orderCurrency },
          );
        }

        const balance = Number(account.balance);
        if (balance < accountAmount) {
          throw new Refusal(`موجودی حساب «${account.name}» کافی نیست. موجودی: ${money(balance, acct)}، مبلغ مورد نیاز: ${money(accountAmount, acct)}.`, {
            balance,
            needed: accountAmount,
            accountCurrency: acct,
          });
        }

        const paidText = `${money(amount, currency)}${currency !== acct ? ` @ ${accountRate}` : ''}`;
        const transaction = await tx.transaction.create({
          data: {
            type: 'EXPENSE',
            amount: new Decimal(accountAmount),
            currency: acct,
            rateSnapshot: new Decimal(tomanRate),
            amountInToman: new Decimal(amountInToman),
            accountId,
            category: 'Purchase Payment',
            description: `پرداخت سفارش خرید #${order.number} — ${paidText}${note ? ` — ${note}` : ''}`,
            date,
          },
        });
        const accountNow = await tx.account.update({
          where: { id: accountId },
          data: { balance: { decrement: new Decimal(accountAmount) } },
          select: { balance: true },
        });
        const payment = await tx.purchaseOrderPayment.create({
          data: {
            purchaseOrderId: order.id,
            amount: new Decimal(amountInToman),
            accountId,
            transactionId: transaction.id,
            description: note,
            date,
            paidAmount: new Decimal(amount),
            paidCurrency: currency,
            accountRate: currency !== acct ? new Decimal(accountRate as number) : null,
            tomanRate: new Decimal(tomanRate),
            accountAmount: new Decimal(accountAmount),
            orderAmount: new Decimal(orderAmount),
            clientRequestId: requestId ?? undefined,
          },
        });

        const settled = before.remaining - orderAmount <= BALANCE_TOLERANCE;
        const placed = order.status === 'DRAFT';
        const status = PAYABLE_IN_PLACE.includes(order.status) ? order.status : settled ? 'PAID' : 'PARTIALLY_PAID';
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status, paymentAccountId: accountId, paymentTransactionId: transaction.id },
        });
        if (settled && orderCurrency !== 'TOMAN') {
          const paidInToman = [...order.payments, payment].reduce((sum: Decimal, p: any) => sum.plus(p.amount), new Decimal(0));
          await fixTomanSnapshots(tx, order, before.total, paidInToman);
        }

        const after = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_PARTS });
        return {
          placed,
          settled,
          log: `پرداخت سفارش خرید PO-${order.number} («${order.supplier.name}»): ${paidText} از حساب «${account.name}» (${money(accountAmount, acct)})، معادل ${money(amountInToman, 'TOMAN')}${placed ? ' — پیش‌نویس با این پرداخت ثبت نهایی شد' : ''} — ${PURCHASE_ORDER_STATUS_LABELS[status]}`,
          ...orderReply(after, rateOf),
          payment: paymentReply(payment, acct),
          account: { id: account.id, name: account.name, currency: acct, balance: Number(accountNow.balance) },
        };
      });
    } catch (error) {
      // The same requestId raced this call and won: answer with its payment.
      if (requestId && isDuplicateRequest(error)) result = await repeated(client);
      else throw error;
    }

    if (result.duplicate) return ok(result);
    const { log, placed, settled, ...body } = result;
    await logActivity(undefined, 'API_PAY_PURCHASE_ORDER', `کلید کامل: ${log}`);
    const left = body.remainingInOrderCurrency;
    return ok({
      message: settled
        ? `پرداخت ثبت شد و سفارش خرید PO-${body.order} کامل تسویه شد.${body.totalAmountInToman != null ? ` مبلغ تومانی سفارش: ${money(body.totalAmountInToman, 'TOMAN')}.` : ''}`
        : `پرداخت ثبت شد. باقیماندهٔ سفارش خرید PO-${body.order}: ${money(left, body.currency)}.`,
      ...(placed && { note: 'سفارش پیش‌نویس بود؛ با این پرداخت ثبت نهایی شد.' }),
      ...body,
    });
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message, error.extra);
    throw error;
  }
}

/**
 * Adds a cost the supplier billed after the PI (a logo, a mould, extra freight) to a purchase order, in the
 * order's currency. The order's total grows by it. An order with no Toman total yet takes it with none; an order
 * that has one (it was paid, or it is in Toman) takes it at the order's own rate, so its Toman total stays the
 * sum of its lines and costs. A PAID order owes again and goes back to PARTIALLY_PAID; one already in production
 * or arrived keeps its status and the cost is paid with payPurchaseOrder. The same title and amount twice is
 * refused, so a call that arrives twice adds one cost.
 */
export async function addPurchaseOrderCost(client: any, fields: any): Promise<Reply> {
  try {
    const title = text(fields.title);
    if (!title) throw new Refusal('عنوان هزینه (title) لازم است.');
    const amount = positive(fields.amount, 'amount', 'مبلغ هزینه');
    const found = await orderIdFor(client, fields.order ?? fields.orderNumber ?? fields.number);

    const result = await client.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${found.id} FOR UPDATE`;
      const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: found.id }, include: ORDER_PARTS });
      const label = PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status;
      if (NO_NEW_COST.includes(order.status)) {
        throw new Refusal(`سفارش خرید PO-${order.number} در وضعیت «${label}» است و هزینهٔ تازه نمی‌گیرد.`, { status: order.status });
      }
      const currency = orderCurrencyOf(order);
      if (!currency) throw new Refusal(`اقلام و هزینه‌های سفارش خرید PO-${order.number} چند ارز دارند؛ هزینه را در صفحهٔ سفارش اضافه کنید.`);
      const same = order.additionalCosts.find((c: any) => c.title.trim().toLowerCase() === title.toLowerCase() && Math.abs(Number(c.amount) - amount) < 0.005);
      if (same) {
        throw new Refusal(`هزینهٔ «${same.title}» به مبلغ ${money(amount, currency)} از قبل روی سفارش خرید PO-${order.number} هست؛ دوباره اضافه نشد.`, { existing: true });
      }

      // The order's own Toman rate, when it has one: 1 in Toman, what was paid on a paid order.
      const total = orderTotalOf(order);
      const tomanTotal = order.totalAmountInToman == null ? null : new Decimal(order.totalAmountInToman);
      const rate = currency === 'TOMAN' ? new Decimal(1) : tomanTotal && tomanTotal.gt(0) && total > 0 ? tomanTotal.div(total) : null;
      const amountInToman = rate ? new Decimal(amount).times(rate) : null;

      await tx.purchaseOrderAdditionalCost.create({
        data: { purchaseOrderId: order.id, title, amount: new Decimal(amount), currency, exchangeRateSnapshot: rate, amountInToman },
      });
      const status = order.status === 'PAID' ? 'PARTIALLY_PAID' : order.status;
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status,
          totalAmount: { increment: new Decimal(amount) },
          ...(amountInToman && { totalAmountInToman: (tomanTotal ?? new Decimal(0)).plus(amountInToman) }),
        },
      });
      const after = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_PARTS });
      return {
        reopened: order.status === 'PAID',
        ...orderReply(after, await rateReader(tx)),
        cost: { title, amount, currency, amountInToman: amountInToman ? Number(amountInToman) : null },
      };
    });

    const { reopened, ...body } = result;
    const costText = `«${title}» ${money(amount, body.currency)}`;
    await logActivity(
      undefined,
      'API_ADD_PURCHASE_ORDER_COST',
      `کلید کامل: هزینهٔ ${costText} به سفارش خرید PO-${body.order} («${body.supplier}») اضافه شد — جمع سفارش ${money(body.totalAmount, body.currency)}${reopened ? ' — از «پرداخت شده» به «پرداخت جزئی» برگشت' : ''}`,
    );
    return ok({
      message: `هزینهٔ ${costText} به سفارش خرید PO-${body.order} اضافه شد. جمع سفارش: ${money(body.totalAmount, body.currency)}، باقیمانده: ${money(body.remainingInOrderCurrency, body.currency)}.${reopened ? ' سفارش از «پرداخت شده» به «پرداخت جزئی» برگشت.' : ''}`,
      ...body,
    });
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message, error.extra);
    throw error;
  }
}
