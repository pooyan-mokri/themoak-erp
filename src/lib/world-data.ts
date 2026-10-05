/**
 * The business world's snapshot (src/lib/world-types.ts): the whole business on
 * one map, built fresh for each poll of /api/world so it is always current.
 *
 * It reuses the dashboards' rules, so its figures are theirs:
 * - «موجودی کل»: cashPosition over every account that holds money (money-totals.ts);
 * - an order's sale: orderNet, after the discount (order-balance.ts);
 * - units sold: netLineSale, net of returns and exchanges (product-sales.ts);
 * - stock levels: stockLevel, low is 3 or fewer (stock-levels.ts);
 * - revenue and expenses: profitEntry, profit and loss's rule (profit-rows.ts);
 * - the sales window: since the start of the Tehran day 30 days ago (tehran-day.ts);
 * - a product's photo: the website's, else the one uploaded here, as every screen shows it (product-image.ts).
 *
 * What a role may not see (permissions.ts) is never read, let alone sent.
 */
import { can } from '@/lib/permissions';
import { LOW_STOCK_MAX, STOCK_TYPES, stockLevel } from '@/lib/stock-levels';
import {
  ORDER_BALANCE_FIELDS,
  PAYABLE_PURCHASE_ORDERS,
  PURCHASE_ORDER_DEBT_FIELDS,
  RECEIVABLE_ORDERS,
  cashPosition,
  latestRates,
  supplierPositions,
  unpaidOnPurchaseOrder,
} from '@/lib/money-totals';
import { orderNet, orderTotals } from '@/lib/order-balance';
import { netLineSale } from '@/lib/product-sales';
import { profitAmount, profitEntry, COGS_CATEGORY } from '@/lib/profit-rows';
import { categoryLabel } from '@/lib/category-labels';
import { isConsignmentOrder } from '@/lib/consignment-amounts';
import { addDays, tehranDay, tehranDayStart } from '@/lib/tehran-day';
import { readSiteConnection, SITE_CATALOGUE_SYNC_KEY, SITE_HOOK_STATUS_KEY } from '@/lib/site-connection';
import { productPhotoOnSite } from '@/lib/product-image';
import type {
  CustomerTier,
  WorldCustomer,
  WorldAccount,
  WorldChannel,
  WorldCustomers,
  WorldData,
  WorldEvent,
  WorldFinance,
  WorldLayers,
  WorldOffice,
  WorldOrder,
  WorldProduct,
  WorldProfit,
  WorldSales,
  WorldSite,
  WorldStock,
  WorldSuppliers,
} from '@/lib/world-types';

const DAY = 86_400_000;
const EVENT_DAYS = 7;
const MAX_EVENTS = 80;
const RECENT_ORDERS = 25;
const TOP_PRODUCTS = 10;
const TOP_CUSTOMERS = 10;
const CHANNELS: WorldChannel[] = ['site', 'shop', 'consignment'];
/** Purchase orders placed and not yet in: not a draft, not received, not cancelled. */
const CLOSED_PURCHASE = ['DRAFT', 'RECEIVED', 'CANCELLED'];
const DONE_TASKS = ['DONE', 'COMPLETED', 'CANCELLED'];
const CLOSED_PROJECTS = ['COMPLETED', 'CANCELLED'];

const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 0 });

export const TIER_LABELS: Record<CustomerTier, string> = { 1: 'الماسی', 2: 'طلایی', 3: 'نقره‌ای', 4: 'برنزی', 5: 'عادی', 6: 'بی‌خرید' };

/**
 * A customer's tier from their rank among the n who ever bought, by what they bought (0 is the best):
 * the top 3% الماسی, the next 7% طلایی, 15% نقره‌ای, 25% برنزی, the rest عادی; each of the first four at
 * least one customer while there are buyers left. Someone who never bought is 6, بی‌خرید.
 */
export function customerTier(rank: number | null, n: number): CustomerTier {
  if (rank === null || n <= 0) return 6;
  let edge = 0;
  for (const [tier, share] of [[1, 0.03], [2, 0.07], [3, 0.15], [4, 0.25]] as const) {
    edge += Math.max(1, Math.round(n * share));
    if (rank < edge) return tier;
  }
  return 5;
}

/** Which parts of the world a role sees. */
export function worldLayers(role: string | null | undefined): WorldLayers {
  const has = (permission: Parameters<typeof can>[1]) => can(role, permission);
  return {
    stock: has('stock.view'),
    sales: has('sales.view'),
    customers: has('sales.view'),
    suppliers: has('stock.view') || has('finance.view'),
    site: has('stock.view') || has('sales.view'),
    finance: has('finance.view'),
    profit: has('profit.view'),
    cost: has('cost.view'),
  };
}

/** The model a product belongs to: the part of its name before « - ». */
export function productFamily(name: string): string {
  return name.split(/\s+-\s+/)[0].trim() || name.trim();
}

type ChannelSource = {
  wooId?: number | null;
  siteReference?: string | null;
  items: Array<{ warehouse?: { isVirtual: boolean } | null }>;
};

/** The website's orders first, then the ones settled with a partner (consignment-amounts.ts), then the shop's. */
export function orderChannel(order: ChannelSource): WorldChannel {
  if (order.siteReference != null || order.wooId != null) return 'site';
  if (order.items.length > 0 && isConsignmentOrder(order)) return 'consignment';
  return 'shop';
}

function readJson(value: string | null | undefined): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  createdAt: true,
  customerId: true,
  customer: { select: { name: true } },
  ...ORDER_BALANCE_FIELDS,
  items: {
    select: {
      productId: true,
      quantity: true,
      price: true,
      warehouseId: true,
      warehouse: { select: { isVirtual: true } },
      returns: { select: { quantity: true } },
      exchanges: { select: { quantity: true } },
    },
  },
} as const;

function orderUnits(order: any): number {
  if (order.status === 'CANCELLED') return order.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
  return order.items.reduce((sum: number, item: any) => sum + netLineSale(item, order).units, 0);
}

function toWorldOrder(order: any): WorldOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    channel: orderChannel(order),
    units: orderUnits(order),
    net: orderNet(order),
    customer: order.customer?.name ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

/** Builds the world for a role. `client` is a Prisma client; `now` is for tests. */
export async function buildWorld(client: any, role: string | null | undefined, now: Date = new Date()): Promise<WorldData> {
  const layers = worldLayers(role);
  const today = tehranDay(now);
  const since = tehranDayStart(addDays(today, -30));
  const todayStart = tehranDayStart(today);
  const eventsSince = new Date(now.getTime() - EVENT_DAYS * DAY);

  const needRates = layers.finance || layers.suppliers;
  const rates = needRates ? await latestRates(client) : [];

  // ── Stock ──────────────────────────────────────────────────────────────────
  let stock: WorldStock | undefined;
  const warehouses = await client.warehouse.findMany({
    where: { isArchived: false },
    select: { id: true, name: true, isVirtual: true, customerId: true, customer: { select: { name: true } } },
    orderBy: [{ isVirtual: 'asc' }, { name: 'asc' }],
  });
  const warehouseIds = new Set<string>(warehouses.map((w: any) => w.id));
  const mainWarehouse = warehouses.find((w: any) => !w.isVirtual) ?? warehouses[0] ?? null;
  const productNames = new Map<string, string>();
  const productPhotos = new Map<string, string | null>();

  // Sales in the window, read once for the sales, the products' units sold and the website.
  let windowOrders: any[] = [];
  if (layers.sales) {
    windowOrders = await client.order.findMany({
      where: { createdAt: { gte: since } },
      select: ORDER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }
  const soldByProduct = new Map<string, number>();
  for (const order of windowOrders) {
    if (order.status === 'CANCELLED') continue;
    for (const item of order.items) {
      soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + netLineSale(item, order).units);
    }
  }

  if (layers.stock || layers.sales) {
    const products = await client.product.findMany({
      where: { productType: { in: [...STOCK_TYPES] } },
      select: {
        id: true, name: true, webId: true, costPrice: true, imageUrl: true, image: true,
        inventory: { select: { warehouseId: true, quantity: true } },
      },
      orderBy: { name: 'asc' },
    });
    for (const p of products) {
      productNames.set(p.id, p.name);
      productPhotos.set(p.id, productPhotoOnSite(p));
    }

    if (layers.stock) {
      const byWarehouse = new Map<string, { units: number; products: number; value: number }>();
      let valueAtCost = 0;
      const rows: WorldProduct[] = products.map((p: any) => {
        const cost = Number(p.costPrice) || 0;
        const here: Record<string, number> = {};
        let units = 0;
        for (const row of p.inventory) {
          if (!warehouseIds.has(row.warehouseId) || row.quantity === 0) continue;
          here[row.warehouseId] = row.quantity;
          units += row.quantity;
          const w = byWarehouse.get(row.warehouseId) ?? { units: 0, products: 0, value: 0 };
          w.units += row.quantity;
          if (row.quantity > 0) {
            w.products += 1;
            w.value += row.quantity * cost;
            valueAtCost += row.quantity * cost;
          }
          byWarehouse.set(row.warehouseId, w);
        }
        return {
          id: p.id,
          name: p.name,
          family: productFamily(p.name),
          units,
          level: stockLevel(units),
          byWarehouse: here,
          onSite: p.webId != null,
          ...(layers.sales && { sold: soldByProduct.get(p.id) ?? 0 }),
        };
      });
      stock = {
        lowMax: LOW_STOCK_MAX,
        warehouses: warehouses.map((w: any) => {
          const totals = byWarehouse.get(w.id) ?? { units: 0, products: 0, value: 0 };
          return {
            id: w.id,
            name: w.name.trim(),
            virtual: w.isVirtual,
            partner: w.isVirtual ? (w.customer?.name ?? null) : null,
            units: totals.units,
            products: totals.products,
            ...(layers.cost && { valueAtCost: Math.round(totals.value) }),
          };
        }),
        products: rows,
        totals: {
          products: rows.length,
          units: rows.reduce((sum, r) => sum + r.units, 0),
          low: rows.filter((r) => r.level === 'LOW').length,
          out: rows.filter((r) => r.level === 'OUT').length,
          ...(layers.cost && { valueAtCost: Math.round(valueAtCost) }),
        },
      };
    }
  }

  // ── Sales ──────────────────────────────────────────────────────────────────
  let sales: WorldSales | undefined;
  if (layers.sales) {
    const live = windowOrders.filter((o) => o.status !== 'CANCELLED');
    const dayRows = new Map<string, { day: string; orders: number; total: number }>();
    for (let d = addDays(today, -30); d <= today; d = addDays(d, 1)) dayRows.set(d, { day: d, orders: 0, total: 0 });
    const channels = new Map<WorldChannel, { channel: WorldChannel; orders: number; total: number }>(
      CHANNELS.map((channel) => [channel, { channel, orders: 0, total: 0 }]),
    );
    let todayOrders = 0;
    let todayTotal = 0;
    let windowTotal = 0;
    for (const order of live) {
      const net = orderNet(order);
      windowTotal += net;
      const row = dayRows.get(tehranDay(order.createdAt));
      if (row) {
        row.orders += 1;
        row.total += net;
      }
      const channel = channels.get(orderChannel(order))!;
      channel.orders += 1;
      channel.total += net;
      if (order.createdAt >= todayStart) {
        todayOrders += 1;
        todayTotal += net;
      }
    }
    const recent = await client.order.findMany({ select: ORDER_SELECT, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], take: RECENT_ORDERS });
    // The window as long again just before it: from as far before its start as now is after it.
    const previousOrders = await client.order.findMany({
      where: { createdAt: { gte: new Date(since.getTime() - (now.getTime() - since.getTime())), lt: since }, status: { not: 'CANCELLED' } },
      select: ORDER_BALANCE_FIELDS,
    });
    sales = {
      since: since.toISOString(),
      today: { orders: todayOrders, total: todayTotal },
      window: { orders: live.length, total: windowTotal },
      previous: { orders: previousOrders.length, total: previousOrders.reduce((sum: number, o: any) => sum + orderNet(o), 0) },
      days: [...dayRows.values()],
      channels: [...channels.values()],
      topProducts: [...soldByProduct.entries()]
        .filter(([, units]) => units > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_PRODUCTS)
        .map(([id, units]) => {
          const name = productNames.get(id) ?? 'نامشخص';
          return { id, name, family: productFamily(name), units, image: productPhotos.get(id) ?? null };
        }),
      recentOrders: recent.map(toWorldOrder),
    };
  }

  // ── Customers ──────────────────────────────────────────────────────────────
  let customers: WorldCustomers | undefined;
  let receivables = 0;
  if (layers.customers || layers.finance) {
    const owing = await client.order.findMany({ where: RECEIVABLE_ORDERS, select: { customerId: true, ...ORDER_BALANCE_FIELDS } });
    const debtBy = new Map<string, number>();
    for (const order of owing) {
      const remaining = orderTotals(order).remaining;
      receivables += remaining;
      if (remaining > 0) debtBy.set(order.customerId, (debtBy.get(order.customerId) ?? 0) + remaining);
    }
    if (layers.customers) {
      const partners = new Set<string>(warehouses.filter((w: any) => w.customerId).map((w: any) => w.customerId));
      for (const c of await client.consignmentChannel.findMany({ select: { customerId: true } })) partners.add(c.customerId);
      const since90 = new Date(now.getTime() - 90 * DAY);
      const bought = await client.order.findMany({
        where: { createdAt: { gte: since90 }, status: { not: 'CANCELLED' }, customerId: { not: null } },
        select: { customerId: true, customer: { select: { name: true } }, ...ORDER_BALANCE_FIELDS },
      });
      const spendBy = new Map<string, { id: string; name: string; orders: number; spend: number }>();
      for (const order of bought) {
        if (partners.has(order.customerId)) continue;
        const row = spendBy.get(order.customerId) ?? { id: order.customerId, name: order.customer?.name ?? '', orders: 0, spend: 0 };
        row.orders += 1;
        row.spend += orderNet(order);
        spendBy.set(order.customerId, row);
      }
      // Every customer by what they ever bought: their tier, their debt and their credit.
      const all = await client.customer.findMany({ select: { id: true, name: true } });
      const lifetime = await client.order.findMany({
        where: { status: { not: 'CANCELLED' }, customerId: { not: null } },
        select: { customerId: true, createdAt: true, ...ORDER_BALANCE_FIELDS },
      });
      const life = new Map<string, { spend: number; orders: number; lastAt: Date | null; overpaid: number }>();
      for (const order of lifetime) {
        const row = life.get(order.customerId) ?? { spend: 0, orders: 0, lastAt: null, overpaid: 0 };
        row.spend += orderNet(order);
        row.orders += 1;
        row.overpaid += orderTotals(order).credit;
        if (!row.lastAt || order.createdAt > row.lastAt) row.lastAt = order.createdAt;
        life.set(order.customerId, row);
      }
      const creditOf = new Map<string, number>(
        (await client.customerCredit.groupBy({ by: ['customerId'], _sum: { amount: true } })).map((r: any) => [r.customerId, Number(r._sum.amount ?? 0)]),
      );
      const ranked = all
        .filter((c: any) => !partners.has(c.id) && (life.get(c.id)?.orders ?? 0) > 0)
        .sort((a: any, b: any) => life.get(b.id)!.spend - life.get(a.id)!.spend);
      const rankOf = new Map<string, number>(ranked.map((c: any, i: number) => [c.id, i]));
      const people: WorldCustomer[] = all
        .filter((c: any) => !partners.has(c.id))
        .map((c: any) => {
          const row = life.get(c.id);
          return {
            id: c.id,
            name: c.name,
            spend: row?.spend ?? 0,
            orders: row?.orders ?? 0,
            debt: debtBy.get(c.id) ?? 0,
            credit: Math.max(0, (creditOf.get(c.id) ?? 0) + (row?.overpaid ?? 0)),
            lastAt: row?.lastAt ? row.lastAt.toISOString() : null,
            tier: customerTier(rankOf.has(c.id) ? rankOf.get(c.id)! : null, ranked.length),
          };
        })
        .sort((a: WorldCustomer, b: WorldCustomer) => a.tier - b.tier || b.spend - a.spend);
      const tiers = ([1, 2, 3, 4, 5, 6] as CustomerTier[]).map((tier) => ({ tier, label: TIER_LABELS[tier], count: people.filter((p) => p.tier === tier).length }));
      // A partner's store: its sales of 90 days, what the partner owes us and what we owe it.
      const partnerOf = new Map<string, string>(warehouses.filter((w: any) => w.isVirtual && w.customerId).map((w: any) => [w.id, w.customerId]));
      if (stock && partnerOf.size) {
        const sold = await client.order.findMany({
          where: { createdAt: { gte: since90 }, status: { not: 'CANCELLED' }, items: { some: { warehouseId: { in: [...partnerOf.keys()] } } } },
          select: { ...ORDER_BALANCE_FIELDS, items: { select: { warehouseId: true } } },
        });
        const salesOf = new Map<string, number>();
        for (const order of sold) {
          const at = order.items.find((i: any) => partnerOf.has(i.warehouseId))?.warehouseId;
          if (at) salesOf.set(at, (salesOf.get(at) ?? 0) + orderNet(order));
        }
        for (const w of stock.warehouses) {
          const partner = partnerOf.get(w.id);
          if (!partner) continue;
          w.sales90 = salesOf.get(w.id) ?? 0;
          w.receivable = debtBy.get(partner) ?? 0;
          w.payable = Math.max(0, creditOf.get(partner) ?? 0);
        }
      }
      customers = {
        people,
        tiers,
        total: await client.customer.count(),
        newInWindow: await client.customer.count({ where: { createdAt: { gte: since } } }),
        buyers90: spendBy.size,
        debtors: debtBy.size,
        receivables,
        top: [...spendBy.values()]
          .sort((a, b) => b.spend - a.spend)
          .slice(0, TOP_CUSTOMERS)
          .map((row) => ({ ...row, debt: debtBy.get(row.id) ?? 0 })),
      };
    }
  }

  // ── Suppliers ──────────────────────────────────────────────────────────────
  let suppliers: WorldSuppliers | undefined;
  let payables = 0;
  if (layers.suppliers || layers.finance) {
    if (layers.finance) payables = (await supplierPositions(client, rates)).unpaidOnOrders;
    if (layers.suppliers) {
      const rows = await client.supplier.findMany({
        select: { id: true, name: true, orders: { select: { status: true, createdAt: true } } },
        orderBy: { name: 'asc' },
      });
      const unpaidBy = new Map<string, number>();
      if (layers.finance) {
        const payable = await client.purchaseOrder.findMany({
          where: PAYABLE_PURCHASE_ORDERS,
          select: { supplierId: true, ...PURCHASE_ORDER_DEBT_FIELDS },
        });
        for (const order of payable) {
          unpaidBy.set(order.supplierId, (unpaidBy.get(order.supplierId) ?? 0) + unpaidOnPurchaseOrder(order, rates));
        }
      }
      const volumeBy = new Map<string, number>();
      const supplierCreditBy = new Map<string, number>();
      if (layers.finance) {
        for (const po of await client.purchaseOrder.findMany({ where: { status: { not: 'CANCELLED' } }, select: { supplierId: true, totalAmountInToman: true } })) {
          volumeBy.set(po.supplierId, (volumeBy.get(po.supplierId) ?? 0) + Number(po.totalAmountInToman ?? 0));
        }
        for (const r of await client.supplierCredit.groupBy({ by: ['supplierId'], _sum: { amount: true } })) supplierCreditBy.set(r.supplierId, Number(r._sum.amount ?? 0));
      }
      suppliers = {
        suppliers: rows.map((s: any) => {
          const last = s.orders.reduce((max: Date | null, o: any) => (!max || o.createdAt > max ? o.createdAt : max), null);
          return {
            id: s.id,
            name: s.name,
            orders: s.orders.filter((o: any) => o.status !== 'CANCELLED').length,
            open: s.orders.filter((o: any) => !CLOSED_PURCHASE.includes(o.status)).length,
            lastOrderAt: last ? last.toISOString() : null,
            ...(layers.finance && { unpaid: unpaidBy.get(s.id) ?? 0, volume: volumeBy.get(s.id) ?? 0, credit: Math.max(0, supplierCreditBy.get(s.id) ?? 0) }),
          };
        }),
        ...(layers.finance && { payables }),
      };
    }
  }

  // ── Website ────────────────────────────────────────────────────────────────
  let site: WorldSite | undefined;
  if (layers.site) {
    const connection = await readSiteConnection(client);
    const settings = await client.systemSetting.findMany({ where: { key: { in: [SITE_HOOK_STATUS_KEY, SITE_CATALOGUE_SYNC_KEY] } } });
    const hook = readJson(settings.find((s: any) => s.key === SITE_HOOK_STATUS_KEY)?.value) ?? {};
    const catalogue = readJson(settings.find((s: any) => s.key === SITE_CATALOGUE_SYNC_KEY)?.value) ?? {};
    let host: string | null = null;
    try {
      host = connection.siteUrl ? new URL(connection.siteUrl).host : null;
    } catch {
      host = null;
    }
    const siteOrders = windowOrders.filter((o) => o.status !== 'CANCELLED' && orderChannel(o) === 'site');
    site = {
      host,
      stockPush: connection.stockPushEnabled,
      productsOnSite: await client.product.count({ where: { webId: { not: null } } }),
      hook: { lastOkAt: hook.lastOkAt ?? null, failingSince: hook.failingSince ?? null, paused: !!hook.paused },
      catalogue: {
        at: catalogue.at ?? null,
        ok: typeof catalogue.ok === 'boolean' ? catalogue.ok : null,
        read: Number(catalogue.read ?? 0),
        updated: Number(catalogue.updated ?? 0),
        notInErp: Array.isArray(catalogue.notInErp) ? catalogue.notInErp.length : 0,
      },
      ...(layers.sales && { orders: { count: siteOrders.length, total: siteOrders.reduce((sum, o) => sum + orderNet(o), 0) } }),
    };
  }

  // ── Money ──────────────────────────────────────────────────────────────────
  let finance: WorldFinance | undefined;
  let profit: WorldProfit | undefined;
  if (layers.finance || layers.profit) {
    const rows = await client.transaction.findMany({
      where: { type: { in: ['INCOME', 'EXPENSE'] }, date: { gte: since } },
      select: {
        type: true, amountInToman: true, amount: true, currency: true, category: true,
        exchangeGroupId: true, transferGroupId: true, LoanPayment: { select: { interest: true } },
      },
    });
    const income = new Map<string, number>();
    const expense = new Map<string, number>();
    let revenue = 0;
    let cogs = 0;
    let expenses = 0;
    for (const row of rows) {
      const entry = profitEntry(row);
      if (!entry) continue;
      if (entry.line === 'revenue') {
        revenue += entry.amount;
        income.set(entry.category, (income.get(entry.category) ?? 0) + entry.amount);
      } else if (entry.line === 'cogs') {
        cogs += entry.amount;
        if (layers.cost) expense.set(entry.category, (expense.get(entry.category) ?? 0) + entry.amount);
      } else {
        expenses += entry.amount;
        expense.set(entry.category, (expense.get(entry.category) ?? 0) + entry.amount);
      }
    }
    const byAmount = (map: Map<string, number>) =>
      [...map.entries()].map(([category, amount]) => ({ category: categoryLabel(category), amount })).sort((a, b) => b.amount - a.amount);

    if (layers.finance) {
      const accounts = await client.account.findMany({
        where: { type: { not: 'EXPENSE' } },
        select: { id: true, name: true, type: true, currency: true, balance: true },
        orderBy: { name: 'asc' },
      });
      const cash = cashPosition(accounts, rates);
      finance = {
        total: cash.total,
        accounts: accounts.map((a: any): WorldAccount => {
          const balance = Number(a.balance);
          const rate = a.currency === 'TOMAN' ? 1 : rates.find((r: any) => r.currency === a.currency)?.rateToToman;
          return { id: a.id, name: a.name, type: a.type, currency: a.currency, balance, toman: rate === undefined ? null : balance * Number(rate) };
        }),
        receivables,
        payables,
        flows: { income: byAmount(income), expense: byAmount(expense) },
      };
    }
    if (layers.profit) profit = { revenue, cogs, expenses, profit: revenue - cogs - expenses };
  }

  // ── Office ─────────────────────────────────────────────────────────────────
  const tasks = await client.task.findMany({ select: { status: true, dueDate: true } });
  const office: WorldOffice = {
    projects: await client.project.count({ where: { status: { notIn: CLOSED_PROJECTS } } }),
    tasks: {
      open: tasks.filter((t: any) => !DONE_TASKS.includes(t.status)).length,
      overdue: tasks.filter((t: any) => !DONE_TASKS.includes(t.status) && t.dueDate && t.dueDate < now).length,
      done: tasks.filter((t: any) => t.status === 'DONE' || t.status === 'COMPLETED').length,
    },
  };

  // ── Events: the last 7 days on the move ────────────────────────────────────
  const events: WorldEvent[] = [];
  const wh = (id: string | null | undefined) => (id && warehouseIds.has(id) ? `wh:${id}` : mainWarehouse ? `wh:${mainWarehouse.id}` : 'hq');

  if (layers.sales) {
    for (const order of windowOrders) {
      if (order.createdAt < eventsSince || order.status === 'CANCELLED') continue;
      const channel = orderChannel(order);
      const units = orderUnits(order);
      events.push({
        id: `order:${order.id}`,
        kind: 'order',
        at: order.createdAt.toISOString(),
        from: wh(order.items[0]?.warehouseId),
        to: channel === 'site' ? 'site' : 'customers',
        label: `سفارش #${fa(order.number)} · ${fa(units)} عدد`,
        units,
        amount: orderNet(order),
      });
    }
  }

  if (layers.stock) {
    const movements = await client.inventoryMovement.findMany({
      where: { createdAt: { gte: eventsSince }, type: { in: layers.sales ? ['TRANSFER', 'PURCHASE', 'RETURN', 'ADJUSTMENT'] : ['TRANSFER', 'PURCHASE', 'RETURN', 'ADJUSTMENT', 'SALE'] } },
      select: { id: true, type: true, quantity: true, fromWarehouseId: true, toWarehouseId: true, referenceId: true, createdAt: true, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const purchaseIds = [...new Set<string>(movements.filter((m: any) => m.type === 'PURCHASE' && m.referenceId).map((m: any) => m.referenceId))];
    const supplierOf = new Map<string, string>();
    if (purchaseIds.length) {
      for (const po of await client.purchaseOrder.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, supplierId: true } })) {
        supplierOf.set(po.id, po.supplierId);
      }
    }
    // One event per move of several products at once: same kind, places and reference, in the same minute.
    const groups = new Map<string, { first: any; units: number; products: Set<string> }>();
    for (const m of movements) {
      const minute = Math.floor(m.createdAt.getTime() / 60_000);
      const key = [m.type, m.fromWarehouseId, m.toWarehouseId, m.referenceId, minute].join('|');
      const group = groups.get(key) ?? { first: m, units: 0, products: new Set<string>() };
      group.units += Math.abs(m.quantity);
      group.products.add(m.product?.name ?? '');
      groups.set(key, group);
    }
    for (const [key, { first: m, units, products }] of groups) {
      const what = products.size === 1 ? [...products][0] : `${fa(products.size)} کالا`;
      const base = { id: `move:${key}`, at: m.createdAt.toISOString(), units };
      if (m.type === 'TRANSFER') {
        events.push({ ...base, kind: 'transfer', from: wh(m.fromWarehouseId), to: wh(m.toWarehouseId), label: `انتقال ${fa(units)} عدد · ${what}` });
      } else if (m.type === 'PURCHASE') {
        const supplierId = m.referenceId ? supplierOf.get(m.referenceId) : undefined;
        events.push({ ...base, kind: 'purchase', from: supplierId ? `sup:${supplierId}` : 'hq', to: wh(m.toWarehouseId), label: `رسید خرید ${fa(units)} عدد · ${what}` });
      } else if (m.type === 'RETURN') {
        events.push({ ...base, kind: 'return', from: 'customers', to: wh(m.toWarehouseId ?? m.fromWarehouseId), label: `مرجوعی ${fa(units)} عدد · ${what}` });
      } else if (m.type === 'SALE') {
        events.push({ ...base, kind: 'sale', from: wh(m.fromWarehouseId), to: 'customers', label: `فروش ${fa(units)} عدد · ${what}` });
      } else {
        const place = wh(m.toWarehouseId ?? m.fromWarehouseId);
        events.push({ ...base, kind: 'adjust', from: place, to: place, label: `اصلاح موجودی ${fa(units)} عدد · ${what}` });
      }
    }
  }

  if (layers.finance) {
    const money = await client.transaction.findMany({
      where: {
        date: { gte: eventsSince },
        type: { in: ['INCOME', 'EXPENSE'] },
        exchangeGroupId: null,
        transferGroupId: null,
        ...(!layers.cost && { NOT: { category: COGS_CATEGORY } }),
      },
      select: { id: true, type: true, category: true, amount: true, amountInToman: true, currency: true, date: true, account: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
    for (const row of money) {
      if (row.category === COGS_CATEGORY) continue; // a sale's cost, written with every order: the order is the event
      const amount = profitAmount(row);
      const category = categoryLabel(row.category || 'سایر');
      const account = row.account?.name ? ` · ${row.account.name}` : '';
      events.push(
        row.type === 'INCOME'
          ? { id: `tx:${row.id}`, kind: 'income', at: row.date.toISOString(), from: 'customers', to: 'treasury', label: `واریز · ${category}${account}`, amount }
          : { id: `tx:${row.id}`, kind: 'expense', at: row.date.toISOString(), from: 'treasury', to: 'out', label: `هزینه · ${category}${account}`, amount },
      );
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));

  return {
    generatedAt: now.toISOString(),
    layers,
    ...(stock && { stock }),
    ...(sales && { sales }),
    ...(customers && { customers }),
    ...(suppliers && { suppliers }),
    ...(site && { site }),
    ...(finance && { finance }),
    ...(profit && { profit }),
    office,
    events: events.slice(0, MAX_EVENTS),
  };
}
