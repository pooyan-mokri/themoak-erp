/**
 * What a personal key (src/lib/api-keys.ts) may do on the ERP API (/api/erp),
 * and the actions only a person may do there: a customer, a sale, a payment on
 * an order, a return, a stock transfer. Each runs the app's own server action
 * (src/actions/*) inside runAsApiUser, so it checks the user's role and keeps
 * every rule the screens keep; what it makes carries the user's name: a tag
 * «Claude · name» where the record has tags, and a line in the activity log.
 *
 * Callers name things the way people do: a product by SKU, a customer by
 * phone, an account or a warehouse by name, an order by number. Each name must
 * match exactly one; otherwise the answer says which ones it could be.
 */
import { can, canAny, ROLE_LABELS, ROLE_PERMISSIONS, type Permission } from '@/lib/permissions';
import { currentApiActor, type ApiActor } from '@/lib/api-actor';
import { apiTag } from '@/lib/api-keys';
import { logActivity } from '@/lib/activity-log';
import { DUPLICATE_REQUEST_MESSAGE, readRequestId } from '@/lib/request-id';
import { randomUUID } from 'node:crypto';

/** The permissions (any of) a personal key's user needs for each action. Not listed: the website's own actions. */
export const PERSONAL_ACTION_PERMISSIONS: Record<string, readonly Permission[]> = {
  whoami: [],
  summary: ['finance.view'],
  accounts: ['finance.view', 'accounts.pick'],
  transactions: ['finance.view'],
  orders: ['sales.view'],
  settlements: ['sales.view'],
  loans: ['payroll.view'],
  search: ['stock.view', 'sales.view', 'finance.view'],
  warehouses: ['stock.view', 'sales.manage'],
  stock: ['stock.view'],
  inventory: ['stock.view'],
  productSales: ['stock.view'],
  deposit: ['finance.manage'],
  expense: ['finance.manage'],
  transfer: ['finance.manage'],
  createCustomer: ['sales.manage'],
  createOrder: ['sales.manage'],
  recordOrderPayment: ['sales.manage'],
  returnOrderItem: ['sales.manage'],
  transferStock: ['stock.manage'],
  // Purchasing (src/lib/erp-api-purchasing.ts), as the supplier pages allow it.
  suppliers: ['stock.view', 'finance.view'],
  purchaseOrders: ['stock.view', 'finance.view'],
  createSupplier: ['stock.manage', 'finance.manage'],
  createProduct: ['stock.manage'],
  createPurchaseOrder: ['cost.edit'],
};

export const PERSONAL_POST_ACTIONS = ['createCustomer', 'createOrder', 'recordOrderPayment', 'returnOrderItem', 'transferStock'];

export function personalMay(role: string, action: string): boolean {
  const needed = PERSONAL_ACTION_PERMISSIONS[action];
  if (!needed) return false;
  return needed.length === 0 || canAny(role, needed);
}

/**
 * Takes out of an answer what the user's role may not see: profit without
 * profit.view, balances without finance.view, cost without cost.view, sell
 * prices without sales.view, and the parts of a search a role does not open.
 */
export function redactForRole(action: string, body: any, role: string): any {
  if (!body || typeof body !== 'object') return body;
  const has = (p: Permission) => can(role, p);
  const strip = (row: any, keys: string[]) => {
    if (row && typeof row === 'object') for (const k of keys) delete row[k];
    return row;
  };
  switch (action) {
    case 'summary':
      if (!has('profit.view')) delete body.last30Days;
      return body;
    case 'accounts':
      if (!has('finance.view') && Array.isArray(body)) body.forEach((a) => strip(a, ['balance']));
      return body;
    case 'inventory':
      if (!has('cost.view')) {
        strip(body.totals, ['valueAtCost']);
        body.products?.forEach((p: any) => strip(p, ['costPrice']));
      }
      if (!has('sales.view')) body.products?.forEach((p: any) => strip(p, ['sellPrice']));
      return body;
    case 'productSales':
      if (!has('cost.view')) body.products?.forEach((p: any) => strip(p, ['costPrice']));
      return body;
    case 'purchaseOrders':
      // As the purchase-order pages show it: prices with cost.view, totals and payments with finance.view, and
      // the order's additional costs (part of both the landed cost and the payable) with either.
      body.purchaseOrders?.forEach((o: any) => {
        if (!has('cost.view')) o.items?.forEach((i: any) => strip(i, ['unitCost']));
        if (!has('cost.view') && !has('finance.view')) delete o.additionalCosts;
        if (!has('finance.view')) strip(o, ['totalAmount', 'totalAmountInToman', 'payments', 'paidInToman', 'unpaidInToman']);
      });
      return body;
    case 'search':
      if (!has('sales.view')) {
        delete body.customers;
        delete body.orders;
      }
      if (!has('finance.view')) delete body.transactions;
      if (!has('stock.view') && !has('sales.view')) delete body.products;
      return body;
    default:
      return body;
  }
}

export function whoami(actor: ApiActor) {
  return {
    name: actor.name,
    email: actor.email,
    role: actor.role,
    roleLabel: ROLE_LABELS[actor.role as keyof typeof ROLE_LABELS] ?? actor.role,
    permissions: ROLE_PERMISSIONS[actor.role as keyof typeof ROLE_PERMISSIONS] ?? [],
    actions: Object.keys(PERSONAL_ACTION_PERMISSIONS).filter((a) => personalMay(actor.role, a)),
  };
}

type Reply = { status: number; body: any };
const ok = (body: any): Reply => ({ status: 200, body: { success: true, ...body } });
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } });
class Ambiguous extends Error {
  constructor(message: string, readonly options: unknown[] = []) {
    super(message);
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');

async function product(client: any, ref: unknown) {
  const key = text(ref);
  if (!key) throw new Ambiguous('کالا را با SKU یا شناسه بگویید.');
  const byKey = await client.product.findFirst({ where: { OR: [{ id: key }, { sku: { equals: key, mode: 'insensitive' } }] }, select: { id: true, name: true, sku: true, sellPrice: true } });
  if (byKey) return byKey;
  const named = await client.product.findMany({ where: { name: { contains: key, mode: 'insensitive' } }, select: { id: true, name: true, sku: true, sellPrice: true }, take: 6 });
  if (named.length === 1) return named[0];
  throw new Ambiguous(named.length ? `«${key}» به چند کالا می‌خورد؛ SKU را بگویید.` : `کالای «${key}» پیدا نشد.`, named.map((p: any) => ({ sku: p.sku, name: p.name })));
}

async function warehouse(client: any, ref: unknown) {
  const key = text(ref);
  if (!key) {
    const main = await client.warehouse.findFirst({ where: { isArchived: false, isVirtual: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    if (main) return main;
    throw new Ambiguous('انباری پیدا نشد.');
  }
  const rows = await client.warehouse.findMany({ where: { isArchived: false, OR: [{ id: key }, { name: { contains: key, mode: 'insensitive' } }] }, select: { id: true, name: true }, take: 6 });
  const exact = rows.find((w: any) => w.id === key || w.name.trim() === key);
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  throw new Ambiguous(rows.length ? `«${key}» به چند انبار می‌خورد.` : `انبار «${key}» پیدا نشد.`, rows.map((w: any) => w.name.trim()));
}

async function account(client: any, ref: unknown) {
  const key = text(ref);
  if (!key) throw new Ambiguous('حساب را بگویید (نام یا شناسه).');
  const rows = await client.account.findMany({ where: { type: { not: 'EXPENSE' }, OR: [{ id: key }, { name: { contains: key, mode: 'insensitive' } }] }, select: { id: true, name: true, currency: true }, take: 6 });
  const exact = rows.find((a: any) => a.id === key || a.name.trim() === key);
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  throw new Ambiguous(rows.length ? `«${key}» به چند حساب می‌خورد.` : `حساب «${key}» پیدا نشد.`, rows.map((a: any) => a.name));
}

async function customer(client: any, fields: any) {
  const id = text(fields.customerId);
  const phone = text(fields.customerPhone).replace(/\s+/g, '');
  const name = text(fields.customerName);
  if (!id && !phone && !name) return null; // a walk-in sale
  const rows = await client.customer.findMany({
    where: id ? { id } : phone ? { phone: { contains: phone } } : { name: { contains: name, mode: 'insensitive' } },
    select: { id: true, name: true, phone: true },
    take: 6,
  });
  const exact = rows.find((c: any) => (name && c.name.trim() === name) || (phone && c.phone?.replace(/\s+/g, '') === phone));
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  throw new Ambiguous(rows.length ? 'مشتری با این مشخصات چند نفر است؛ شماره موبایل را بگویید.' : 'مشتری پیدا نشد؛ اول با createCustomer ثبتش کنید.', rows.map((c: any) => ({ name: c.name, phone: c.phone })));
}

async function order(client: any, fields: any) {
  const id = text(fields.orderId);
  const number = num(fields.orderNumber);
  const row = await client.order.findFirst({
    where: id ? { id } : Number.isInteger(number) ? { number } : { id: '\u0000' },
    select: { id: true, number: true, items: { select: { id: true, quantity: true, warehouseId: true, product: { select: { sku: true, name: true } } } } },
  });
  if (!row) throw new Ambiguous('سفارش پیدا نشد؛ شمارهٔ سفارش (orderNumber) را بگویید.');
  return row;
}

function form(values: Record<string, unknown>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== '') f.append(k, String(v));
  return f;
}

function failed(result: any): Reply {
  const message = result?.message || result?.error || 'انجام نشد.';
  return refuse(422, message, result?.errors ? { details: result.errors } : {});
}

/** Runs one of PERSONAL_POST_ACTIONS for the key's user (inside runAsApiUser). */
export async function personalPost(client: any, action: string, fields: any): Promise<Reply> {
  const actor = currentApiActor();
  if (!actor) return refuse(403, 'این کار فقط با کلید شخصی یک کاربر ممکن است.');
  const tag = apiTag(actor);
  try {
    switch (action) {
      case 'createCustomer': {
        const { createCustomer } = await import('@/actions/customer');
        const name = text(fields.name);
        if (!name) return refuse(422, 'نام مشتری لازم است.');
        const result: any = await createCustomer(null, form({ name, phone: text(fields.phone), email: text(fields.email), address: text(fields.address) }));
        if (!result?.success) return failed(result);
        await logActivity(actor.id, 'API_CREATE_CUSTOMER', `${tag}: مشتری «${name}» ثبت شد`);
        return ok({ message: result.message, customer: result.customer });
      }

      case 'createOrder': {
        const { createOrder } = await import('@/actions/sales');
        const lines = Array.isArray(fields.items) ? fields.items : [];
        if (!lines.length) return refuse(422, 'اقلام سفارش (items) لازم است: [{ sku, quantity, price? }].');
        const items = [];
        for (const line of lines) {
          const p = await product(client, line.sku ?? line.productId ?? line.product);
          const quantity = num(line.quantity ?? 1);
          const price = line.price === undefined || line.price === null || line.price === '' ? Number(p.sellPrice) : num(line.price);
          items.push({ productId: p.id, quantity, price, name: p.name });
        }
        const who = await customer(client, fields);
        const money = await account(client, fields.account ?? fields.accountId);
        const wh = await warehouse(client, fields.warehouse ?? fields.warehouseId);
        const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
        const discount = fields.discount === undefined ? 0 : num(fields.discount);
        // The sale's id comes from its request id (src/actions/sales.ts): the same request twice is one sale.
        const requestId = readRequestId(fields.requestId) ?? randomUUID();
        const paidAmount = fields.paidAmount === undefined ? undefined : num(fields.paidAmount);
        const result: any = await createOrder({
          customerId: who?.id ?? '',
          items: items.map(({ productId, quantity, price }) => ({ productId, quantity, price })),
          paymentMethod: 'ACCOUNT',
          accountId: money.id,
          totalAmount,
          discount,
          paidAmount,
          warehouseId: wh.id,
          saleDate: text(fields.date) || undefined,
          tags: [tag],
          requestId,
        });
        if (!result?.success) return failed(result);
        const repeated = result.message === DUPLICATE_REQUEST_MESSAGE;
        const placed = await client.order.findUnique({ where: { id: `pos-${requestId}` }, select: { id: true, number: true, totalAmount: true, discount: true, paidAmount: true, paymentStatus: true } });
        if (!repeated) await logActivity(actor.id, 'API_CREATE_ORDER', `${tag}: سفارش #${placed?.number ?? '?'} — ${items.map((i) => `${i.name} × ${fa(i.quantity)}`).join('، ')} — ${fa(totalAmount - discount)} تومان`);
        return ok({
          message: result.message ?? 'سفارش ثبت شد.',
          order: placed && { id: placed.id, number: placed.number, total: Number(placed.totalAmount), discount: Number(placed.discount), paid: Number(placed.paidAmount), paymentStatus: placed.paymentStatus },
          customer: who?.name ?? null,
          account: money.name,
          warehouse: wh.name.trim(),
        });
      }

      case 'recordOrderPayment': {
        const { recordOrderPayment } = await import('@/actions/sales');
        const o = await order(client, fields);
        const money = await account(client, fields.account ?? fields.accountId);
        const amount = num(fields.amount);
        const result: any = await recordOrderPayment(o.id, money.id, amount, text(fields.requestId) || undefined);
        if (!result?.success) return failed(result);
        if (result.message !== DUPLICATE_REQUEST_MESSAGE) await logActivity(actor.id, 'API_ORDER_PAYMENT', `${tag}: پرداخت ${fa(amount)} تومان برای سفارش #${o.number} به ${money.name}`);
        return ok({ message: result.message ?? 'پرداخت ثبت شد.', order: o.number, account: money.name, amount });
      }

      case 'returnOrderItem': {
        const { returnOrderItem } = await import('@/actions/order-return');
        const o = await order(client, fields);
        const want = text(fields.sku ?? fields.product).toLowerCase();
        const lines = o.items.filter((i: any) => !want || i.product.sku.toLowerCase() === want || i.product.name.toLowerCase().includes(want));
        if (lines.length !== 1) {
          return refuse(422, lines.length ? 'این سفارش چند قلم دارد؛ SKU کالای مرجوعی را بگویید.' : 'این کالا در سفارش نیست.', { items: o.items.map((i: any) => ({ sku: i.product.sku, name: i.product.name, quantity: i.quantity })) });
        }
        const line = lines[0];
        const money = await account(client, fields.account ?? fields.accountId);
        const wh = fields.warehouse || fields.warehouseId ? await warehouse(client, fields.warehouse ?? fields.warehouseId) : { id: line.warehouseId, name: '' };
        const quantity = num(fields.quantity ?? 1);
        const result: any = await returnOrderItem(null, form({
          orderId: o.id,
          orderItemId: line.id,
          quantity,
          reason: text(fields.reason) || undefined,
          accountId: money.id,
          warehouseId: wh.id,
          expectedCash: fields.expectedCash,
          requestId: text(fields.requestId) || undefined,
        }));
        if (!result?.success) return failed(result);
        if (result.message !== DUPLICATE_REQUEST_MESSAGE) await logActivity(actor.id, 'API_RETURN', `${tag}: مرجوعی ${fa(quantity)} عدد ${line.product.name} از سفارش #${o.number}`);
        return ok({ message: result.message ?? 'مرجوعی ثبت شد.', order: o.number, product: line.product.name, quantity, refund: result.refund ?? undefined });
      }

      case 'transferStock': {
        const { transferStock } = await import('@/actions/inventory');
        const p = await product(client, fields.sku ?? fields.productId ?? fields.product);
        const from = await warehouse(client, fields.from ?? fields.fromWarehouse);
        const to = await warehouse(client, fields.to ?? fields.toWarehouse);
        const quantity = num(fields.quantity);
        const result: any = await transferStock(p.id, from.id, to.id, quantity, text(fields.note) || undefined, undefined, [tag]);
        if (!result?.success) return failed(result);
        await logActivity(actor.id, 'API_TRANSFER_STOCK', `${tag}: انتقال ${fa(quantity)} عدد ${p.name} از ${from.name.trim()} به ${to.name.trim()}`);
        return ok({ message: result.message ?? 'انتقال انجام شد.', product: p.name, from: from.name.trim(), to: to.name.trim(), quantity });
      }
    }
    return refuse(404, 'Unknown action');
  } catch (error) {
    if (error instanceof Ambiguous) return refuse(422, error.message, error.options.length ? { options: error.options } : {});
    throw error;
  }
}
