/**
 * Website sales in the ERP: the createSale and setSaleStatus actions of
 * /api/erp (docs/erp-prompt.md §3). Kept out of the route so tests can call it.
 *
 * A result is 200 or a 422 the site shows to a person; anything thrown becomes
 * a 500, which the site retries. So a malformed body is always a 422, and a
 * failure that a retry could fix is always a throw.
 */
import { Prisma } from '@prisma/client';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import {
  DEFAULT_PAYMENT_ACCOUNT_NAME,
  DEFAULT_SITE_WAREHOUSE_NAME,
  pickWithDefault,
  readSiteConnection,
} from '@/lib/site-connection';
import {
  SITE_UNKNOWN_NAME,
  SITE_UNKNOWN_SKU,
  TAG_NEEDS_REVIEW,
  TAG_STOCK_SHORTAGE,
  formatShipTo,
  readSiteOrderData,
  unrealPayment,
  type SiteOrderData,
  type SiteShipTo,
  type SiteStatusEvent,
} from '@/lib/site-sale-data';
import { syncInvoiceWithOrder } from '@/lib/sales-records';

export type SiteSaleResult = { status: 200 | 422; body: Record<string, unknown> };

// The site gives up on a POST after 20 s. A sale can still commit after that;
// the site's retry then gets the same answer, so a late commit is harmless.
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

const invalid = (error: string): SiteSaleResult => ({ status: 422, body: { error } });
const fa = (n: number) => n.toLocaleString('fa-IR');

// A number the ERP cannot store is a malformed body, not a 500 the site would
// retry forever. 10^15 Toman is far above any order, and sums of such amounts
// stay exact in JavaScript; stock counts are 32-bit integers.
const MAX_AMOUNT = 1e15;
const MAX_QUANTITY = 1_000_000;
const AMOUNT_RULE = `عدد نامنفی و حداکثر ${fa(MAX_AMOUNT)}`;

// ── Reading the body ─────────────────────────────────────────────────────────
// null and a missing field mean the same thing everywhere.

/** A trimmed non-empty string, else null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** An id the site may send as a string or a number, else null. */
function ident(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
}

/** A non-negative number up to MAX_AMOUNT; null when absent; undefined when malformed. */
function money(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT ? value : undefined;
}

/** A date; null when absent; undefined when malformed. */
function when(value: unknown): Date | null | undefined {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(NaN);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The digits of a mobile number, with +98 / 0098 / 98 turned into a leading 0,
 * and Persian or Arabic digits read as digits. customerIdByMobile repeats this
 * rule in SQL for the numbers already stored.
 */
export function normalizeMobile(raw: string): string {
  const digits = raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
  // +98 0912… and 0098 0912…: a country code typed in front of a full 09 number.
  if (digits.startsWith('00980') && digits.length === 15) return digits.slice(4);
  if (digits.startsWith('980') && digits.length === 13) return digits.slice(2);
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
}

export function paymentStatusFor(net: number, paid: number): string {
  if (paid >= net) return 'PAID';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/** Serializes work on `key` until the transaction ends. */
async function lock(tx: any, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** The account the settings page shows as receiving website money. */
async function paymentAccount(tx: any): Promise<{ id: string; currency: string } | null> {
  const connection = await readSiteConnection(tx);
  const accounts = await tx.account.findMany({
    where: { type: { not: 'EXPENSE' } },
    select: { id: true, name: true, currency: true },
    orderBy: { name: 'asc' },
  });
  const id = pickWithDefault(accounts, connection.paymentAccountId, DEFAULT_PAYMENT_ACCOUNT_NAME);
  return accounts.find((account: any) => account.id === id) ?? null;
}

/** The warehouse the settings page shows as the site's. */
async function siteWarehouseId(tx: any): Promise<string | null> {
  const connection = await readSiteConnection(tx);
  const warehouses = await tx.warehouse.findMany({
    where: { isArchived: false, isVirtual: false },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return pickWithDefault(warehouses, connection.warehouseId, DEFAULT_SITE_WAREHOUSE_NAME);
}

// ── createSale ───────────────────────────────────────────────────────────────

type SaleLine = {
  webId: string | null;
  name: string | null;
  quantity: number;
  unitPrice: number;
  siteProductId: string | null;
};

type SaleInput = {
  reference: string;
  issuedAt: Date;
  tag: string | null;
  warehouseId: string;
  customer: SiteOrderData['customer'];
  shipTo: SiteShipTo | null;
  shipping: SiteOrderData['shipping'];
  lines: SaleLine[];
  subtotal: number | null;
  discount: number;
  coupon: string | null;
  total: number;
  payment: {
    gateway: string | null;
    trackId: string | null;
    refNumber: string | null;
    paidAt: Date | null;
    amount: number;
    sandbox: boolean;
  };
};

/** The sale, or the reason it is malformed. */
function parseSale(body: Record<string, unknown>, reference: string): SaleInput | string {
  const issuedAt = when(body.issuedAt);
  if (!issuedAt) return 'issuedAt باید تاریخ معتبر (ISO-8601) باشد.';
  const currency = text(body.currency);
  if (currency && currency.toLowerCase() !== 'toman') return 'مبلغ‌ها باید به تومان باشند (currency: "toman").';
  const warehouseId = text(body.warehouseId);
  if (!warehouseId) return 'warehouseId الزامی است.';

  const customer = record(body.customer);
  const rawMobile = text(customer?.mobile);
  const mobile = rawMobile ? normalizeMobile(rawMobile) : '';
  if (!mobile) return 'customer.mobile الزامی است.';

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) return 'items باید آرایه‌ای ناخالی باشد.';
  const lines: SaleLine[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = record(items[i]);
    const quantity = item?.quantity;
    const unitPrice = money(item?.unitPrice);
    if (!item || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || unitPrice == null) {
      return `قلم ${i + 1}: quantity باید عدد صحیح مثبت و حداکثر ${fa(MAX_QUANTITY)}، و unitPrice ${AMOUNT_RULE} باشد.`;
    }
    lines.push({
      // erpId is the same value under the older contract's name.
      webId: text(item.webId) ?? text(item.erpId),
      name: text(item.name),
      quantity,
      unitPrice,
      siteProductId: ident(item.productId),
    });
  }
  // Lines of one frame are added up into one stock change.
  if (lines.reduce((sum, line) => sum + line.quantity, 0) > MAX_QUANTITY) {
    return `جمع quantity اقلام باید حداکثر ${fa(MAX_QUANTITY)} باشد.`;
  }

  const total = money(body.total);
  const discount = money(body.discount);
  const subtotal = money(body.subtotal);
  if (total == null || discount === undefined || subtotal === undefined) {
    return `total الزامی است، و total، subtotal و discount باید ${AMOUNT_RULE} باشند.`;
  }
  const payment = record(body.payment);
  const paid = money(payment?.amount);
  const paidAt = when(payment?.paidAt);
  if (!payment || paid == null || paidAt === undefined) {
    return `payment.amount الزامی است (${AMOUNT_RULE}) و payment.paidAt باید تاریخ معتبر باشد.`;
  }
  const shipping = record(body.shipping);
  const freight = money(shipping?.freight);
  if (freight === undefined) return `shipping.freight باید ${AMOUNT_RULE} باشد.`;
  const shipTo = record(body.shipTo);
  const ordersBefore = customer?.ordersBefore;

  return {
    reference,
    issuedAt,
    tag: text(body.tag),
    warehouseId,
    customer: {
      name: text(customer?.name),
      mobile,
      email: text(customer?.email),
      siteId: ident(customer?.siteId),
      ordersBefore:
        typeof ordersBefore === 'number' && Number.isInteger(ordersBefore) && ordersBefore >= 0 ? ordersBefore : null,
    },
    shipTo: shipTo
      ? {
          province: text(shipTo.province),
          city: text(shipTo.city),
          address: text(shipTo.address),
          postal: ident(shipTo.postal),
          note: text(shipTo.note),
        }
      : null,
    shipping: shipping
      ? {
          zone: text(shipping.zone),
          carrier: text(shipping.carrier),
          freight,
          free: typeof shipping.free === 'boolean' ? shipping.free : null,
          trackingCode: ident(shipping.trackingCode),
        }
      : null,
    lines,
    subtotal,
    discount: discount ?? 0,
    coupon: text(body.coupon),
    total,
    payment: {
      gateway: text(payment.gateway),
      trackId: ident(payment.trackId),
      refNumber: ident(payment.refNumber),
      paidAt,
      amount: paid,
      sandbox: payment.sandbox === true || payment.test === true,
    },
  };
}

function saleByReference(client: any, reference: string): Promise<{ id: string; number: number } | null> {
  return client.order.findUnique({ where: { siteReference: reference }, select: { id: true, number: true } });
}

const saleResponse = (order: { id: string; number: number }): SiteSaleResult => ({
  status: 200,
  body: { id: order.id, number: String(order.number) },
});

/**
 * A repeat of a sale the site may not have recorded yet (its first answer was
 * lost). The site subtracts unrecorded sales from any count it receives, so a
 * count pushed before it had the answer was subtracted twice; its frames are
 * queued to be sent again once the site has this answer. No kick: the next
 * scheduled drain comes after the site has written it down.
 */
async function resendStockOf(client: any, orderId: string) {
  await client.$executeRaw`
    INSERT INTO "SiteHookLog" ("productId", "kind", "createdAt")
    SELECT DISTINCT "productId", 'resync', now() AT TIME ZONE 'UTC' FROM "OrderItem" WHERE "orderId" = ${orderId}`;
}

function isSiteReferenceUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes('siteReference');
}

export async function createSale(client: any, body: Record<string, unknown>): Promise<SiteSaleResult> {
  const reference = text(body.reference);
  if (!reference || reference.length > 100) return invalid('reference الزامی است (حداکثر ۱۰۰ نویسه).');

  // A retry of a sale that already committed gets the same answer, whatever
  // has changed since (the warehouse archived, a field now malformed).
  const existing = await saleByReference(client, reference);
  if (existing) {
    await resendStockOf(client, existing.id);
    return saleResponse(existing);
  }

  const input = parseSale(body, reference);
  if (typeof input === 'string') return invalid(input);

  // The customer has already paid, so a bad warehouse never loses the sale. An
  // archived one is used as sent; an unknown or consignment (virtual) one is
  // replaced by the site's warehouse from settings. Both are flagged.
  const sent = await client.warehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, isArchived: true, isVirtual: true },
  });
  let warehouse: { id: string; isArchived: boolean; note: string | null };
  if (sent && !sent.isVirtual) {
    warehouse = { id: sent.id, isArchived: sent.isArchived, note: null };
  } else {
    const fallbackId = await siteWarehouseId(client);
    // Nothing to deduct from until the settings are fixed: let the site retry.
    if (!fallbackId) throw new Error('انبار سایت پیدا نشد؛ آن را در «تنظیمات › اتصال سایت» انتخاب کنید.');
    warehouse = {
      id: fallbackId,
      isArchived: false,
      note: `انبار ارسالی سایت (${input.warehouseId}) معتبر نبود؛ از انبار سایت کم شد.`,
    };
  }

  try {
    const order = await client.$transaction((tx: any) => recordSale(tx, input, warehouse), TX_OPTIONS);
    return saleResponse(order);
  } catch (error) {
    // Two sends of one order that still collided: the loser answers with the winner.
    if (isSiteReferenceUniqueViolation(error)) {
      const winner = await saleByReference(client, reference);
      if (winner) {
        await resendStockOf(client, winner.id);
        return saleResponse(winner);
      }
    }
    throw error;
  }
}

async function recordSale(
  tx: any,
  input: SaleInput,
  warehouse: { id: string; isArchived: boolean; note: string | null },
): Promise<{ id: string; number: number }> {
  await lock(tx, `site-sale:${input.reference}`);
  const existing = await saleByReference(tx, input.reference);
  if (existing) {
    await resendStockOf(tx, existing.id);
    return existing;
  }

  const review: string[] = [];
  const tags = new Set<string>([input.tag ?? 'website']);
  const claimed = input.payment.amount;
  // A test payment, or one the gateway left no trace of, is not money that
  // arrived: the sale is recorded unpaid, for a person to look at.
  const unreal = unrealPayment(input.payment);
  const paid = unreal ? 0 : claimed;
  if (unreal && claimed > 0) {
    review.push(
      unreal === 'sandbox'
        ? `پرداخت ${fa(claimed)} تومانی سایت آزمایشی (sandbox) بود؛ درآمدی ثبت نشد و سفارش پرداخت‌نشده ماند.`
        : `پرداخت ${fa(claimed)} تومانی سایت ردّی از درگاه ندارد (trackId ندارد)؛ درآمدی ثبت نشد و سفارش پرداخت‌نشده ماند. اگر پول واقعاً رسیده است، دریافت آن را در «بررسی پول سفارش‌های سایت» ثبت کنید.`,
    );
  }

  // The account before any stock row, the order POS sales lock them in.
  let account: { id: string; currency: string } | null = null;
  if (paid > 0) {
    account = await paymentAccount(tx);
    if (!account) {
      throw new Error('حساب دریافت پول فروش سایت پیدا نشد؛ آن را در «تنظیمات › اتصال سایت» انتخاب کنید.');
    }
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
  }

  const customerId = await customerIdByMobile(tx, input.customer, formatShipTo(input.shipTo));
  if (!/^09\d{9}$/.test(input.customer.mobile)) {
    review.push(`شمارهٔ موبایل «${input.customer.mobile}» شمارهٔ ایرانی نیست.`);
  }
  if (warehouse.isArchived) review.push('انبار این فروش بایگانی شده است.');
  if (warehouse.note) review.push(warehouse.note);

  // Items match on webId only. An unknown one still sells, on the placeholder.
  const webIds = Array.from(new Set(input.lines.map((line) => line.webId).filter((id): id is string => !!id)));
  const known = webIds.length
    ? await tx.product.findMany({
        where: { webId: { in: webIds }, sku: { not: SITE_UNKNOWN_SKU } },
        select: { id: true, webId: true },
      })
    : [];
  const productByWebId = new Map<string, string>(known.map((product: any) => [product.webId, product.id]));
  const unknownLines = input.lines.filter((line) => !line.webId || !productByWebId.has(line.webId));
  let placeholderId: string | null = null;
  if (unknownLines.length > 0) {
    const placeholder = await tx.product.upsert({
      where: { sku: SITE_UNKNOWN_SKU },
      update: {},
      create: { sku: SITE_UNKNOWN_SKU, name: SITE_UNKNOWN_NAME, costPrice: 0, sellPrice: 0, productType: 'OTHER' },
      select: { id: true },
    });
    placeholderId = placeholder.id;
    for (const line of unknownLines) {
      review.push(`کالای ناشناخته: ${line.webId ?? 'بدون شناسه'}${line.name ? ` (${line.name})` : ''}`);
    }
  }
  const productOf = (line: SaleLine) =>
    ((line.webId && productByWebId.get(line.webId)) || placeholderId) as string;

  // Deduct even what isn't there: the sale happened, the shortfall gets a tag.
  // Rows in a fixed order, so two sales of the same frames can't deadlock.
  const quantities = new Map<string, number>();
  for (const line of input.lines) {
    quantities.set(productOf(line), (quantities.get(productOf(line)) ?? 0) + line.quantity);
  }
  for (const productId of Array.from(quantities.keys()).sort()) {
    const quantity = quantities.get(productId) as number;
    const row = await tx.inventory.upsert({
      where: { productId_warehouseId: { productId, warehouseId: warehouse.id } },
      update: { quantity: { decrement: quantity } },
      create: { productId, warehouseId: warehouse.id, quantity: -quantity },
      select: { quantity: true },
    });
    if (row.quantity < 0 && productId !== placeholderId) tags.add(TAG_STOCK_SHORTAGE);
  }

  // The site's numbers are taken as they are; a mismatch is only flagged.
  const freightCharged = input.shipping?.free ? 0 : input.shipping?.freight ?? 0;
  if (input.subtotal !== null && input.subtotal - input.discount + freightCharged !== input.total) {
    review.push('جمع اقلام منهای تخفیف به‌علاوهٔ هزینهٔ ارسال با جمع سفارش نمی‌خواند.');
  }
  const linesTotal = input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  if (linesTotal !== (input.subtotal ?? input.total + input.discount - freightCharged)) {
    review.push('جمع قیمت اقلام (قیمت واحد × تعداد) با جمع اقلام سفارش نمی‌خواند.');
  }
  if (claimed !== input.total) {
    review.push(`مبلغ پرداخت‌شده (${fa(claimed)} تومان) با جمع سفارش (${fa(input.total)} تومان) برابر نیست.`);
  }
  if (review.length > 0) tags.add(TAG_NEEDS_REVIEW);

  let transactionId: string | undefined;
  if (account) {
    const { amount, rate } = await inAccountCurrency(tx, account, paid);
    const income = await tx.transaction.create({
      data: {
        type: 'INCOME',
        category: 'Sales',
        accountId: account.id,
        amount: new Prisma.Decimal(amount),
        currency: account.currency,
        rateSnapshot: new Prisma.Decimal(rate),
        amountInToman: new Prisma.Decimal(paid),
        customerId,
        date: input.issuedAt,
        description: `فروش سایت ${input.reference}`,
        tags: ['website'],
      },
    });
    transactionId = income.id;
    await tx.account.update({
      where: { id: account.id },
      data: { balance: { increment: new Prisma.Decimal(amount) } },
    });
  }

  const siteData: SiteOrderData = {
    issuedAt: input.issuedAt.toISOString(),
    tag: input.tag,
    customer: input.customer,
    shipTo: input.shipTo,
    shipping: input.shipping,
    payment: { ...input.payment, paidAt: input.payment.paidAt ? input.payment.paidAt.toISOString() : null },
    subtotal: input.subtotal,
    discount: input.discount,
    coupon: input.coupon,
    total: input.total,
    unknownLines,
    history: [],
    review,
  };
  const order = await tx.order.create({
    data: {
      customerId,
      // Gross before discount, the POS convention, so totalAmount - discount is
      // what the customer paid. Freight is part of the sale.
      totalAmount: input.total + input.discount,
      discount: input.discount,
      paidAmount: paid,
      paymentStatus: paymentStatusFor(input.total, paid),
      status: 'COMPLETED',
      transactionId,
      // The income row points back at its order (Transaction.orderId).
      moneyRows: transactionId ? { connect: [{ id: transactionId }] } : undefined,
      createdAt: input.issuedAt,
      tags: Array.from(tags),
      siteReference: input.reference,
      siteData,
      items: {
        create: input.lines.map((line) => ({
          productId: productOf(line),
          quantity: line.quantity,
          price: line.unitPrice,
          warehouseId: warehouse.id,
        })),
      },
    },
    select: { id: true, number: true },
  });
  await tx.inventoryMovement.createMany({
    data: input.lines.map((line) => ({
      productId: productOf(line),
      fromWarehouseId: warehouse.id,
      quantity: line.quantity,
      type: 'SALE',
      referenceId: order.id,
      note: `فروش سایت ${input.reference}`,
    })),
  });
  return order;
}

/** Finds the customer by mobile, or creates one. Fresh details win; empty ones never erase. */
async function customerIdByMobile(
  tx: any,
  customer: SaleInput['customer'],
  address: string | null,
): Promise<string> {
  // Two first orders from one new number must make one customer, not two.
  await lock(tx, `site-customer:${customer.mobile}`);
  // Stored phones were typed by hand (+98, spaces, Persian digits), so they go
  // through normalizeMobile's rule too. A consignment partner (a customer who
  // owns a warehouse) is never matched: website sales stay out of settlements.
  const rows = (await tx.$queryRaw`
    SELECT c.id FROM (
      SELECT cu.id, cu."createdAt",
        regexp_replace(translate(coalesce(cu.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') AS d
      FROM "Customer" cu
      WHERE NOT EXISTS (SELECT 1 FROM "Warehouse" w WHERE w."customerId" = cu.id)
    ) c
    WHERE CASE
      WHEN c.d LIKE '00980%' AND length(c.d) = 15 THEN substr(c.d, 5)
      WHEN c.d LIKE '980%' AND length(c.d) = 13 THEN substr(c.d, 3)
      WHEN c.d LIKE '0098%' THEN '0' || substr(c.d, 5)
      WHEN c.d LIKE '98%' AND length(c.d) = 12 THEN '0' || substr(c.d, 3)
      WHEN c.d LIKE '9%' AND length(c.d) = 10 THEN '0' || c.d
      ELSE c.d
    END = ${customer.mobile}
    ORDER BY c."createdAt" ASC, c.id ASC
    LIMIT 1
  `) as Array<{ id: string }>;

  const details = {
    ...(customer.name ? { name: customer.name } : {}),
    ...(customer.email ? { email: customer.email } : {}),
    ...(address ? { address } : {}),
    ...(customer.siteId ? { siteId: customer.siteId } : {}),
  };
  if (rows[0]) {
    if (Object.keys(details).length > 0) {
      await tx.customer.update({ where: { id: rows[0].id }, data: details });
    }
    return rows[0].id;
  }
  const created = await tx.customer.create({
    data: { name: customer.mobile, ...details, phone: customer.mobile, source: 'website' },
    select: { id: true },
  });
  return created.id;
}

// ── setSaleStatus ────────────────────────────────────────────────────────────

const STATUSES = ['shipped', 'delivered', 'returned', 'refunded', 'cancelled'];

/** The same event sent again, e.g. a retry after a timeout. */
function isRepeat(history: SiteStatusEvent[], event: SiteStatusEvent): boolean {
  return history.some(
    (e) =>
      e.status === event.status &&
      e.at === event.at &&
      e.trackingCode === event.trackingCode &&
      e.amount === event.amount &&
      e.restock === event.restock &&
      e.refundId === event.refundId,
  );
}

type StatusChange = {
  reference: string | null;
  saleId: string | null;
  event: SiteStatusEvent;
  refund: number | null;
  refundId: string | null;
  refundedTotal: number | null;
  restock: boolean;
};

export async function setSaleStatus(client: any, body: Record<string, unknown>): Promise<SiteSaleResult> {
  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
  if (!STATUSES.includes(status)) {
    return invalid('status باید یکی از shipped، delivered، returned، refunded یا cancelled باشد.');
  }
  const reference = text(body.reference);
  const saleId = ident(body.saleId);
  if (!reference && !saleId) return invalid('reference یا saleId الزامی است.');
  const at = when(body.at);
  const amount = money(body.amount);
  const refundedTotal = money(body.refundedTotal);
  if (at === undefined || amount === undefined || refundedTotal === undefined) {
    return invalid(`at باید تاریخ معتبر باشد، و amount و refundedTotal ${AMOUNT_RULE}.`);
  }
  if (body.restock != null && typeof body.restock !== 'boolean') return invalid('restock باید true یا false باشد.');
  if (status === 'refunded' && amount === null) return invalid('amount برای refunded الزامی است.');
  // A refund is money going back: every refunded, and a cancelled that carries an amount.
  const refund = status === 'refunded' || (status === 'cancelled' && (amount ?? 0) > 0) ? (amount as number) : null;
  // A cancel carries at most one refund, so it may come without a refundId.
  const refundId = ident(body.refundId) ?? (status === 'cancelled' && refund !== null ? 'cancelled' : null);
  if (refund !== null && !refundId) return invalid('refundId برای هر بازپرداخت الزامی است.');

  const change: StatusChange = {
    reference,
    saleId,
    event: {
      status,
      at: (at ?? new Date()).toISOString(),
      receivedAt: new Date().toISOString(),
      trackingCode: ident(body.trackingCode),
      amount,
      restock: typeof body.restock === 'boolean' ? body.restock : null,
      refundId,
    },
    refund,
    refundId,
    refundedTotal,
    restock: body.restock === true,
  };
  return client.$transaction((tx: any) => applyStatus(tx, change), TX_OPTIONS);
}

async function applyStatus(tx: any, change: StatusChange): Promise<SiteSaleResult> {
  // A status sent while its createSale is still being recorded waits for it.
  if (change.reference) await lock(tx, `site-sale:${change.reference}`);
  const byReference = change.reference
    ? await tx.order.findUnique({ where: { siteReference: change.reference }, select: { id: true } })
    : null;
  const byId = change.saleId
    ? await tx.order.findFirst({ where: { id: change.saleId, siteReference: { not: null } }, select: { id: true } })
    : null;
  if (byReference && byId && byReference.id !== byId.id) {
    return invalid('saleId و reference دو فروش متفاوت را نشان می‌دهند.');
  }
  const found = byReference ?? byId;
  if (!found) return invalid('این فروش در ERP ثبت نشده است.');

  // Every decision below is made from this locked, freshly read row.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: found.id },
    include: {
      items: { select: { productId: true, quantity: true, warehouseId: true } },
      transaction: { select: { account: { select: { id: true, currency: true } } } },
      siteRefunds: { select: { refundId: true, amount: true } },
      invoice: { select: { id: true } },
    },
  });
  const data = readSiteOrderData(order.siteData);
  if (!data) throw new Error(`سفارش سایت ${order.siteReference} اطلاعات سایت ندارد.`);
  const reference = order.siteReference as string;

  const review: string[] = [];
  const discount = Number(order.discount);
  let paid = Number(order.paidAmount);
  let totalAmount = Number(order.totalAmount);
  let status: string = order.status;
  const refundedBefore = order.siteRefunds.reduce((sum: number, r: any) => sum + Number(r.amount), 0);
  let refundedNow = 0;

  // Each refund the site reports is booked once, and never beyond what was paid.
  const alreadyBooked =
    change.refund !== null && order.siteRefunds.some((r: any) => r.refundId === change.refundId);
  if (alreadyBooked) {
    const first = data.history.find((event) => event.refundId === change.refundId && event.amount != null);
    if (first && first.amount !== change.refund) {
      review.push(
        `بازپرداخت ${change.refundId} دوباره با مبلغ دیگری (${fa(change.refund as number)} تومان) آمد و نادیده گرفته شد.`,
      );
    }
  }
  if (change.refund !== null && !alreadyBooked) {
    const remaining = Math.max(0, data.payment.amount - refundedBefore);
    refundedNow = Math.min(change.refund, remaining);
    if (change.refund > remaining) {
      review.push(
        `بازپرداخت ${fa(change.refund)} تومان از ماندهٔ پرداخت (${fa(remaining)} تومان) بیشتر بود؛ ${fa(refundedNow)} تومان ثبت شد.`,
      );
    }
    // Money leaves an account only as far as the ERP holds this order's money:
    // none for a sale recorded unpaid (a test or untraced payment), less once a
    // refund was already booked in the ERP.
    const booked = Math.min(refundedNow, paid);
    if (booked < refundedNow) {
      review.push(
        `از بازپرداخت ${fa(refundedNow)} تومانی سایت، ${fa(booked)} تومان از حساب کم شد؛ ERP بیش از این از پول این سفارش را نگه نداشته بود.`,
      );
    }
    let transactionId: string | null = null;
    if (booked > 0) {
      // Out of the account the sale's money went into.
      const account = order.transaction?.account ?? (await paymentAccount(tx));
      if (!account) throw new Error('حساب بازپرداخت سفارش سایت پیدا نشد.');
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
      const { amount, rate } = await inAccountCurrency(tx, account, booked);
      const expense = await tx.transaction.create({
        data: {
          type: 'EXPENSE',
          category: 'Return',
          accountId: account.id,
          amount: new Prisma.Decimal(amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(booked),
          customerId: order.customerId ?? undefined,
          orderId: order.id,
          date: new Date(change.event.at),
          description: `بازپرداخت سفارش سایت ${reference}`,
          tags: ['website'],
        },
      });
      transactionId = expense.id;
      await tx.account.update({
        where: { id: account.id },
        data: { balance: { decrement: new Prisma.Decimal(amount) } },
      });
    }
    await tx.siteRefund.create({
      data: {
        orderId: order.id,
        refundId: change.refundId,
        transactionId,
        amount: refundedNow,
        at: new Date(change.event.at),
      },
    });
    if (change.refundedTotal !== null && change.refundedTotal !== refundedBefore + refundedNow) {
      review.push(
        `جمع بازپرداخت‌ها در سایت (${fa(change.refundedTotal)} تومان) با ERP (${fa(refundedBefore + refundedNow)} تومان) نمی‌خواند.`,
      );
    }
    paid -= booked;
    totalAmount = Math.max(discount, totalAmount - refundedNow);
  }

  const fullyRefunded = data.payment.amount > 0 && refundedBefore + refundedNow >= data.payment.amount;
  if (change.event.status === 'cancelled' || (change.event.status === 'refunded' && fullyRefunded)) {
    if (status !== 'CANCELLED') {
      status = 'CANCELLED';
      await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
    }
    if (paid > 0) {
      review.push(
        `سفارش لغو شد ولی ${fa(paid)} تومان از پول آن بازپرداخت نشده است؛ در «بررسی پول سفارش‌های سایت» بازپرداخت یا نگه‌داشتن آن را ثبت کنید.`,
      );
    }
  }
  // A void sale owes nothing, so no reader shows debt for it.
  if (status === 'CANCELLED') totalAmount = discount + paid;

  // Goods come back once, whatever the status, into the warehouse they left.
  let restockedNow = false;
  if (change.restock) {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, siteRestockedAt: null },
      data: { siteRestockedAt: new Date() },
    });
    restockedNow = claimed.count === 1;
    if (restockedNow) {
      const fallback = order.items.some((item: any) => !item.warehouseId) ? await siteWarehouseId(tx) : null;
      const back = new Map<string, { productId: string; warehouseId: string; quantity: number }>();
      for (const item of order.items) {
        const warehouseId: string | null = item.warehouseId ?? fallback;
        if (!warehouseId) {
          review.push('انباری برای برگرداندن کالا پیدا نشد؛ موجودی را دستی اصلاح کنید.');
          continue;
        }
        if (!item.warehouseId) review.push('انبار این فروش حذف شده بود؛ کالا به انبار سایت برگشت.');
        const key = `${item.productId}|${warehouseId}`;
        back.set(key, { productId: item.productId, warehouseId, quantity: (back.get(key)?.quantity ?? 0) + item.quantity });
      }
      for (const key of Array.from(back.keys()).sort()) {
        const { productId, warehouseId, quantity } = back.get(key) as { productId: string; warehouseId: string; quantity: number };
        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId, warehouseId } },
          update: { quantity: { increment: quantity } },
          create: { productId, warehouseId, quantity },
        });
        await tx.inventoryMovement.create({
          data: {
            productId,
            toWarehouseId: warehouseId,
            quantity,
            type: 'RETURN',
            referenceId: order.id,
            note: `بازگشت کالای سفارش سایت ${reference}`,
          },
        });
      }
    }
  }

  // Restock is always the whole sale, and the site sends it apart from a partial
  // refund, in either order: flag it on whichever event completes the pair.
  const restocked = restockedNow || order.siteRestockedAt != null;
  if (restocked && !fullyRefunded && refundedBefore + refundedNow > 0 && (restockedNow || refundedNow > 0)) {
    review.push('کل سفارش به انبار برگشت ولی بازپرداخت جزئی بود.');
  }
  // Cancelled before it shipped and nothing came back: the goods are probably still on the shelf.
  const shipped = data.history.some((event) => event.status === 'shipped' || event.status === 'delivered');
  if (order.status !== 'CANCELLED' && status === 'CANCELLED' && !restocked && !shipped) {
    review.push('سفارش پیش از ارسال لغو شد ولی کالایی به انبار برنگشت؛ اگر کالا در انبار است، موجودی را اصلاح کنید.');
  }

  const tags = new Set<string>(order.tags);
  if (review.length > 0) tags.add(TAG_NEEDS_REVIEW);
  await tx.order.update({
    where: { id: order.id },
    data: {
      status,
      paidAmount: paid,
      totalAmount,
      paymentStatus: paymentStatusFor(totalAmount - discount, paid),
      tags: Array.from(tags),
      siteData: {
        ...data,
        history: isRepeat(data.history, change.event) ? data.history : [...data.history, change.event],
        review: Array.from(new Set([...data.review, ...review])),
      },
    },
  });
  if (order.invoice) {
    await syncInvoiceWithOrder(order.id, tx);
    if (status === 'CANCELLED') {
      await tx.invoice.update({ where: { id: order.invoice.id }, data: { status: 'CANCELLED' } });
    }
  }
  return { status: 200, body: { ok: true } };
}
