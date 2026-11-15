/**
 * Purchasing on the ERP API (/api/erp): suppliers, new products, and purchase orders for the suppliers in China.
 * The owner's full key may call these, and a personal key what its user's role may (PERSONAL_ACTION_PERMISSIONS in
 * src/lib/erp-api-personal.ts); the website's key may not.
 *
 * A purchase order is recorded as the supplier's PI states it: one currency (mostly CNY) and no Toman snapshot.
 * Its Toman value is the rate actually paid, decided when it is paid; until then every reader prices it at the
 * latest rate (unpaidOnPurchaseOrder in src/lib/money-totals.ts, src/lib/landed-cost.ts), as the payment code
 * does. An order in Toman needs no rate and keeps its Toman figures. The exchange-rate table is not read here.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { can, canAny, type Permission } from '@/lib/permissions';
import { currentApiActor, type ApiActor } from '@/lib/api-actor';
import { apiTag } from '@/lib/api-keys';
import { logActivity } from '@/lib/activity-log';
import { generateUniqueBarcode } from '@/lib/barcode-utils';
import { kickSiteHook } from '@/lib/site-hook';
import { PAYABLE_PURCHASE_ORDERS, latestRates, unpaidOnPurchaseOrder } from '@/lib/money-totals';
import { PURCHASE_ORDER_STATUS_LABELS } from '@/lib/purchase-order-status';
import { orderBalance } from '@/lib/purchase-order-balance';

export const PURCHASING_GET_ACTIONS = ['suppliers', 'purchaseOrders'];
export const PURCHASING_POST_ACTIONS = ['createSupplier', 'createProduct', 'createPurchaseOrder'];
// Paying an order and adding a cost to it: src/lib/erp-api-po-payments.ts (the full key only).

const CURRENCIES = ['TOMAN', 'USD', 'EUR', 'CNY'];
const CURRENCY_NAMES: Record<string, string> = { TOMAN: 'تومان', USD: 'دلار', EUR: 'یورو', CNY: 'یوان' };
const PRODUCT_TYPES = ['SALEABLE', 'FIXED_ASSET', 'CONSUMABLE', 'OTHER'];
/** What a new order may start as: a draft, or placed and waiting for its payment. */
const START_STATUSES = ['DRAFT', 'PENDING_PAYMENT'];
/** A tag naming the supplier's proforma invoice: two live orders may not carry the same one. */
const PI_TAG = /^PI:/;

type Reply = { status: number; body: any };
const ok = (body: any): Reply => ({ status: 200, body: { success: true, ...body } });
const refuse = (error: string, extra: Record<string, unknown> = {}): Reply => ({ status: 422, body: { error, ...extra } });

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
/** A number from JSON or a numeric string; NaN for anything else, missing included. */
const amount = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 2 });

/** Who is acting: a personal key's user, or the owner's full key (no user). */
const who = (actor: ApiActor | undefined) => (actor ? apiTag(actor) : 'کلید کامل');
/** A personal key's user may do this; the full key may do everything. */
const may = (actor: ApiActor | undefined, permission: Permission) => !actor || can(actor.role, permission);

// ── Reading ──────────────────────────────────────────────────────────────────

export async function listSuppliers(client: any) {
  const rows = await client.supplier.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, phone: true, email: true, _count: { select: { orders: true } } },
  });
  return rows.map((s: any) => ({ id: s.id, name: s.name, phone: s.phone ?? null, email: s.email ?? null, purchaseOrders: s._count.orders }));
}

/** Recent purchase orders, newest first; `supplier` (name or id), `status` and `tag` narrow them. */
export async function listPurchaseOrders(client: any, params: URLSearchParams): Promise<Reply> {
  const raw = Number(params.get('limit') ?? 30);
  const limit = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, 100) : 30;
  const status = text(params.get('status'));
  if (status && !PURCHASE_ORDER_STATUS_LABELS[status]) {
    return refuse(`status باید یکی از ${Object.keys(PURCHASE_ORDER_STATUS_LABELS).join('، ')} باشد.`);
  }
  const supplier = text(params.get('supplier'));
  const tag = text(params.get('tag'));
  const orders = await client.purchaseOrder.findMany({
    where: {
      ...(status && { status }),
      ...(tag && { tags: { has: tag } }),
      ...(supplier && { OR: [{ supplierId: supplier }, { supplier: { name: { contains: supplier, mode: 'insensitive' } } }] }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { sku: true, name: true } } }, orderBy: { id: 'asc' } },
      additionalCosts: true,
      payments: {
        select: {
          amount: true, date: true, description: true,
          paidAmount: true, paidCurrency: true, accountAmount: true, accountRate: true, tomanRate: true, orderAmount: true,
          account: { select: { name: true, currency: true } },
        },
        orderBy: { date: 'asc' },
      },
    },
  });
  const rates = await latestRates(client);
  const payable = (s: string) => !PAYABLE_PURCHASE_ORDERS.status.notIn.includes(s);
  const rateOf = (currency: string) => (currency === 'TOMAN' ? 1 : Number(rates.find((r: any) => r.currency === currency)?.rateToToman ?? 0));
  const orNull = (v: unknown) => (v == null ? null : Number(v));
  return {
    status: 200,
    body: {
    purchaseOrders: orders.map((o: any) => {
      const paid = o.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      // In the order's own currency (src/lib/purchase-order-balance.ts); none for an order in mixed currencies.
      const balance = orderBalance(o, rateOf);
      return {
        id: o.id,
        number: o.number,
        supplier: o.supplier.name,
        supplierId: o.supplier.id,
        status: o.status,
        tags: o.tags,
        createdAt: o.createdAt,
        // totalAmount is in the order's currency (its first line's); the Toman total exists only once it is known.
        currency: o.items[0]?.currency ?? 'TOMAN',
        totalAmount: Number(o.totalAmount),
        totalAmountInToman: o.totalAmountInToman == null ? null : Number(o.totalAmountInToman),
        items: o.items.map((i: any) => ({
          sku: i.product.sku,
          name: i.product.name,
          quantity: i.quantity,
          unitCost: Number(i.unitCost),
          currency: i.currency,
          receivedQuantity: i.receivedQuantity ?? 0,
        })),
        additionalCosts: o.additionalCosts.map((c: any) => ({
          title: c.title,
          amount: Number(c.amount),
          currency: c.currency,
          amountInToman: c.amountInToman == null ? null : Number(c.amountInToman),
        })),
        // amountInToman is every payment's Toman value. A payment recorded in the currency actually paid
        // (payPurchaseOrder) also says what was paid, what left the account and at which rates; the others have null there.
        payments: o.payments.map((p: any) => ({
          amountInToman: Number(p.amount),
          date: p.date,
          description: p.description ?? null,
          paidAmount: orNull(p.paidAmount),
          paidCurrency: p.paidCurrency ?? null,
          account: p.account?.name ?? null,
          accountCurrency: p.account?.currency ?? null,
          accountAmount: orNull(p.accountAmount),
          accountRate: orNull(p.accountRate),
          tomanRate: orNull(p.tomanRate),
          inOrderCurrency: orNull(p.orderAmount),
        })),
        paidInToman: paid,
        paidInOrderCurrency: balance?.paid ?? null,
        remainingInOrderCurrency: balance ? (payable(o.status) ? balance.remaining : 0) : null,
        // Still owed, as the dashboard counts it: nothing on a draft or a cancelled order; an order with no Toman total at the latest rate.
        unpaidInToman: payable(o.status) ? unpaidOnPurchaseOrder(o, rates) : 0,
      };
    }),
    },
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

const email = z.string().email();

/** A new supplier. A name already taken (case and outer spaces aside) is refused. */
export async function createSupplier(client: any, fields: any): Promise<Reply> {
  const actor = currentApiActor();
  const name = text(fields.name);
  if (!name) return refuse('نام تأمین‌کننده (name) لازم است.');
  const phone = text(fields.phone) || null;
  const mail = text(fields.email) || null;
  const address = text(fields.address) || null;
  if (mail && !email.safeParse(mail).success) return refuse('ایمیل نامعتبر است.');

  const made = await client.$transaction(async (tx: any) => {
    // Two calls with one name: the second waits, then finds the first.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'supplier:' + name.toLowerCase()}))`;
    const [taken] = await tx.$queryRaw`SELECT id, name FROM "Supplier" WHERE lower(btrim(name)) = lower(${name}) LIMIT 1`;
    if (taken) return { taken };
    return { supplier: await tx.supplier.create({ data: { name, phone, email: mail, address } }) };
  });
  if (made.taken) return refuse(`تأمین‌کننده‌ای با نام «${made.taken.name}» از قبل هست.`, { supplier: { id: made.taken.id, name: made.taken.name } });

  const s = made.supplier;
  await logActivity(actor?.id, 'API_CREATE_SUPPLIER', `${who(actor)}: تأمین‌کنندهٔ «${name}» ثبت شد`);
  return ok({ message: 'تأمین‌کننده ثبت شد.', supplier: { id: s.id, name: s.name, phone: s.phone, email: s.email, address: s.address } });
}

/**
 * A new product, as the product form makes one: a fresh in-store barcode, no website id, and a nudge to the
 * website hook. It is not on the website: the site sells only products given a site id (webId) on the product page.
 * Without cost.edit the cost starts at 0, without sales.view the sell price does, as on the form.
 */
export async function createProduct(client: any, fields: any): Promise<Reply> {
  const actor = currentApiActor();
  const sku = text(fields.sku);
  const name = text(fields.name);
  if (!sku) return refuse('کد کالا (sku) لازم است.');
  if (!name) return refuse('نام کالا (name) لازم است.');
  const sellPrice = amount(fields.sellPrice);
  if (!Number.isFinite(sellPrice) || sellPrice < 0) return refuse('قیمت فروش (sellPrice) به تومان لازم است و منفی نمی‌شود.');
  const costPrice = fields.costPrice === undefined || fields.costPrice === null || fields.costPrice === '' ? 0 : amount(fields.costPrice);
  if (!Number.isFinite(costPrice) || costPrice < 0) return refuse('قیمت خرید (costPrice) باید عدد صفر یا بیشتر باشد.');
  const productType = text(fields.productType) || 'SALEABLE';
  if (!PRODUCT_TYPES.includes(productType)) return refuse(`productType باید یکی از ${PRODUCT_TYPES.join('، ')} باشد.`);

  const taken = await client.product.findFirst({ where: { sku: { equals: sku, mode: 'insensitive' } }, select: { sku: true, name: true } });
  if (taken) return refuse(`کد کالای «${taken.sku}» از قبل برای «${taken.name}» ثبت شده است.`);

  const ignored = [...(may(actor, 'cost.edit') ? [] : ['costPrice']), ...(may(actor, 'sales.view') ? [] : ['sellPrice'])];
  let product: any;
  try {
    product = await client.product.create({
      data: {
        sku,
        name,
        productType,
        barcode: await generateUniqueBarcode(client),
        costPrice: ignored.includes('costPrice') ? 0 : costPrice,
        sellPrice: ignored.includes('sellPrice') ? 0 : sellPrice,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return refuse(`کد کالای «${sku}» از قبل هست.`);
    throw error;
  }
  kickSiteHook();
  await logActivity(actor?.id, 'API_CREATE_PRODUCT', `${who(actor)}: کالای «${name}» (${sku}) ثبت شد`);
  return ok({
    message: 'کالا ثبت شد. روی سایت نمی‌رود تا شناسهٔ سایتش در صفحهٔ کالا گذاشته شود.',
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      barcode: product.barcode,
      productType: product.productType,
      costPrice: Number(product.costPrice),
      sellPrice: Number(product.sellPrice),
      onWebsite: false,
    },
    ...(ignored.length > 0 && { ignored, note: 'نقش شما این قیمت‌ها را نمی‌گذارد؛ صفر ثبت شد.' }),
  });
}

class Refusal extends Error {
  constructor(message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

async function supplierFor(client: any, ref: unknown) {
  const key = text(ref);
  if (!key) throw new Refusal('تأمین‌کننده (supplier) را با نام یا شناسه بگویید.');
  const rows = await client.supplier.findMany({
    where: { OR: [{ id: key }, { name: { contains: key, mode: 'insensitive' } }] },
    select: { id: true, name: true },
    take: 6,
  });
  const exact = rows.find((s: any) => s.id === key || s.name.trim().toLowerCase() === key.toLowerCase());
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  throw new Refusal(
    rows.length ? `«${key}» به چند تأمین‌کننده می‌خورد؛ نام کامل را بگویید.` : `تأمین‌کنندهٔ «${key}» پیدا نشد؛ اول با createSupplier ثبتش کنید.`,
    rows.length ? { options: rows.map((s: any) => s.name) } : {},
  );
}

function currencyOf(value: unknown, fallback: string, where: string): string {
  const c = text(value).toUpperCase() || fallback;
  if (!c) throw new Refusal(`ارز ${where} (currency) لازم است: ${CURRENCIES.join('، ')}.`);
  if (!CURRENCIES.includes(c)) throw new Refusal(`ارز ${where} باید یکی از ${CURRENCIES.join('، ')} باشد.`);
  return c;
}

/**
 * A purchase order as the supplier's PI states it: lines by SKU at the supplier's price, the order's additional
 * costs, all in one currency, and no Toman figure (see the top of this file). The same SKU may come twice, a free
 * line (unitCost 0) included. A tag «PI:…» names the PI: an order already carrying it, not cancelled, refuses it.
 */
export async function createPurchaseOrder(client: any, fields: any): Promise<Reply> {
  const actor = currentApiActor();
  try {
    const supplier = await supplierFor(client, fields.supplier ?? fields.supplierId ?? fields.supplierName);
    const orderCurrency = text(fields.currency).toUpperCase();

    const lines: any[] = Array.isArray(fields.items) ? fields.items : [];
    if (!lines.length) throw new Refusal('اقلام سفارش (items) لازم است: [{ sku, quantity, unitCost, currency }].');
    const items = lines.map((line, i) => {
      const where = `ردیف ${fa(i + 1)}`;
      const sku = text(line?.sku);
      if (!sku) throw new Refusal(`${where}: کد کالا (sku) لازم است.`);
      const quantity = amount(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new Refusal(`${where}: تعداد (quantity) باید عدد صحیح ۱ یا بیشتر باشد.`);
      const unitCost = amount(line.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new Refusal(`${where}: قیمت واحد (unitCost) لازم است و منفی نمی‌شود؛ قلم رایگان ۰ است.`);
      return { sku, quantity, unitCost, currency: currencyOf(line.currency, orderCurrency, where) };
    });
    const costs = (Array.isArray(fields.additionalCosts) ? fields.additionalCosts : []).map((cost: any, i: number) => {
      const where = `هزینهٔ اضافی ${fa(i + 1)}`;
      const title = text(cost?.title);
      if (!title) throw new Refusal(`${where}: عنوان (title) لازم است.`);
      const value = amount(cost.amount);
      if (!Number.isFinite(value) || value < 0) throw new Refusal(`${where}: مبلغ (amount) لازم است و منفی نمی‌شود.`);
      return { title, amount: value, currency: currencyOf(cost.currency, orderCurrency || items[0].currency, where) };
    });

    const currencies = Array.from(new Set([...items, ...costs].map((x) => x.currency)));
    if (currencies.length > 1) {
      throw new Refusal(`هر سفارش خرید یک ارز دارد (ارز PI تأمین‌کننده)؛ این سفارش ${currencies.join(' و ')} را با هم دارد.`, { currencies });
    }
    const currency = currencies[0];

    const status = text(fields.status) || 'DRAFT';
    if (!START_STATUSES.includes(status)) throw new Refusal('status فقط DRAFT (پیش‌نویس، پیش‌فرض) یا PENDING_PAYMENT (منتظر پرداخت) است.');
    // Placing an order with the supplier is a status move, as on the order page.
    if (status !== 'DRAFT' && actor && !canAny(actor.role, ['stock.manage', 'finance.manage'])) {
      throw new Refusal('نقش شما سفارش را فقط پیش‌نویس ثبت می‌کند.');
    }

    if (fields.tags !== undefined && (!Array.isArray(fields.tags) || fields.tags.some((t: unknown) => typeof t !== 'string'))) {
      throw new Refusal('tags باید فهرستی از متن باشد، مثلاً ["PI:2026-031"].');
    }
    const tags: string[] = Array.from(new Set([...(fields.tags ?? []).map((t: string) => t.trim()).filter(Boolean), ...(actor ? [apiTag(actor)] : [])]));
    const piTags = tags.filter((t) => PI_TAG.test(t));

    // Every SKU at once, so an unknown one stops the order before anything is written.
    const wanted = Array.from(new Set(items.map((i) => i.sku.toLowerCase())));
    const found = await client.product.findMany({
      where: { OR: wanted.map((sku) => ({ sku: { equals: sku, mode: 'insensitive' } })) },
      select: { id: true, sku: true, name: true },
    });
    const unknown = wanted
      .filter((sku) => !found.some((p: any) => p.sku.toLowerCase() === sku))
      .map((sku) => items.find((i) => i.sku.toLowerCase() === sku)!.sku);
    if (unknown.length) throw new Refusal(`این کدها کالا ندارند؛ اول با createProduct ثبتشان کنید: ${unknown.join('، ')}`, { unknownSkus: unknown });
    const productOf = (sku: string) => {
      const matches = found.filter((p: any) => p.sku.toLowerCase() === sku.toLowerCase());
      const exact = matches.find((p: any) => p.sku === sku);
      if (exact || matches.length === 1) return exact ?? matches[0];
      throw new Refusal(`کد «${sku}» به چند کالا می‌خورد (${matches.map((p: any) => p.sku).join('، ')})؛ کد را دقیق بنویسید.`);
    };
    const priced = items.map((i) => ({ ...i, product: productOf(i.sku) }));

    // In the order's currency. An order in Toman keeps its Toman figures (rate 1); any other waits for its payment.
    const total = [...priced.map((i) => new Decimal(i.unitCost).times(i.quantity)), ...costs.map((c: any) => new Decimal(c.amount))]
      .reduce((sum, x) => sum.plus(x), new Decimal(0));
    const toman = currency === 'TOMAN';

    const order = await client.$transaction(async (tx: any) => {
      // Two calls for one PI: the second waits, then finds the first.
      for (const tag of piTags.sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'po-tag:' + tag}))`;
      if (piTags.length) {
        const same = await tx.purchaseOrder.findFirst({
          where: { tags: { hasSome: piTags }, status: { not: 'CANCELLED' } },
          select: { id: true, number: true, tags: true, supplier: { select: { name: true } } },
        });
        if (same) {
          throw new Refusal(`این PI قبلاً با سفارش خرید PO-${same.number} (${same.supplier.name}) ثبت شده است.`, {
            existing: { id: same.id, number: same.number, tags: same.tags },
          });
        }
      }
      return tx.purchaseOrder.create({
        data: {
          supplierId: supplier.id,
          status,
          tags,
          totalAmount: total,
          totalAmountInToman: toman ? total : null,
          items: {
            create: priced.map((i) => ({
              productId: i.product.id,
              quantity: i.quantity,
              unitCost: new Decimal(i.unitCost),
              currency: i.currency,
              ...(toman && { exchangeRateSnapshot: new Decimal(1), unitCostInToman: new Decimal(i.unitCost) }),
            })),
          },
          ...(costs.length > 0 && {
            additionalCosts: {
              create: costs.map((c: any) => ({
                title: c.title,
                amount: new Decimal(c.amount),
                currency: c.currency,
                ...(toman && { exchangeRateSnapshot: new Decimal(1), amountInToman: new Decimal(c.amount) }),
              })),
            },
          }),
        },
        include: { items: { orderBy: { id: 'asc' } }, additionalCosts: true },
      });
    });

    const units = priced.reduce((sum, i) => sum + i.quantity, 0);
    const totalText = `${fa(Number(total))} ${CURRENCY_NAMES[currency]}`;
    await logActivity(
      actor?.id,
      'API_CREATE_PURCHASE_ORDER',
      `${who(actor)}: سفارش خرید PO-${order.number} از «${supplier.name}» — ${fa(priced.length)} ردیف، ${fa(units)} عدد — ${totalText}${piTags.length ? ` — ${piTags.join('، ')}` : ''}`,
    );
    return ok({
      message: `سفارش خرید PO-${order.number} (${PURCHASE_ORDER_STATUS_LABELS[status]}) به مبلغ ${totalText} ثبت شد.${toman ? '' : ' مبلغ تومانی هنگام پرداخت، با نرخی که پرداخت می‌شود، معلوم می‌شود.'}`,
      purchaseOrder: {
        id: order.id,
        number: order.number,
        supplier: supplier.name,
        status: order.status,
        tags: order.tags,
        currency,
        totalAmount: Number(total),
        totals: { [currency]: Number(total) },
        totalAmountInToman: order.totalAmountInToman == null ? null : Number(order.totalAmountInToman),
        items: priced.map((i) => ({ sku: i.product.sku, name: i.product.name, quantity: i.quantity, unitCost: i.unitCost, currency: i.currency, lineTotal: Number(new Decimal(i.unitCost).times(i.quantity)) })),
        additionalCosts: costs,
      },
    });
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message, error.extra);
    throw error;
  }
}
