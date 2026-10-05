/**
 * What the business world (/dashboard/world) is drawn from: one snapshot of the
 * whole business, built by src/lib/world-data.ts and polled by the page. Plain
 * types, shared by the server and the client.
 *
 * Every part is there only for a role that may see it (src/lib/permissions.ts):
 * a part a role may not see is absent, not empty, and so is every amount in a
 * part it may see without the money permission.
 */
import type { StockLevel } from '@/lib/stock-levels';

/** Where an order was sold: the website, in person at the shop, or by a consignment partner. */
export type WorldChannel = 'site' | 'shop' | 'consignment';

/**
 * A place on the map an event travels between:
 * `wh:<id>` a warehouse (a consignment partner's store is its virtual warehouse),
 * `sup:<id>` a supplier, `site` the website, `customers`, `treasury`, `out`
 * (money spent), `hq`.
 */
export type WorldPlace = string;

export type WorldLayers = {
  stock: boolean;
  sales: boolean;
  customers: boolean;
  suppliers: boolean;
  site: boolean;
  finance: boolean;
  profit: boolean;
  cost: boolean;
};

export type WorldWarehouse = {
  id: string;
  name: string;
  /** A consignment partner's stock (امانی), at their store. */
  virtual: boolean;
  /** The partner who holds a virtual warehouse's stock. */
  partner: string | null;
  units: number;
  /** Products with stock here. */
  products: number;
  /** cost.view only: units here at their cost price. */
  valueAtCost?: number;
  /** sales.view only, a partner's store: what its orders of the last 90 days came to, after discounts. */
  sales90?: number;
  /** sales.view only, a partner's store: what the partner still owes us on its orders. */
  receivable?: number;
  /** sales.view only, a partner's store: what we owe the partner (their credit). */
  payable?: number;
};

export type WorldProduct = {
  id: string;
  name: string;
  /** The model, the part of the name before « - » (YEK, DAMN VOID…): products of one model share a colour. */
  family: string;
  /** Net units over the warehouses (a negative row subtracts), the dashboards' figure. */
  units: number;
  level: StockLevel;
  /** Units by warehouse id, rows that are not 0. */
  byWarehouse: Record<string, number>;
  onSite: boolean;
  /** sales.view only: units sold in the sales window, net of returns and exchanges. */
  sold?: number;
};

export type WorldStock = {
  lowMax: number;
  warehouses: WorldWarehouse[];
  products: WorldProduct[];
  totals: { products: number; units: number; low: number; out: number; valueAtCost?: number };
};

export type WorldOrder = {
  id: string;
  number: number;
  status: string;
  paymentStatus: string;
  channel: WorldChannel;
  units: number;
  /** What the customer pays, after the discount. */
  net: number;
  customer: string | null;
  createdAt: string;
};

export type WorldSales = {
  /** Since the start of the Tehran day 30 days ago, as on the dashboard. */
  since: string;
  today: { orders: number; total: number };
  window: { orders: number; total: number };
  /** The window as long again just before this one, by the same rules: the world's weather compares the two. */
  previous: { orders: number; total: number };
  /** Every Tehran day of the window, days without a sale included. */
  days: Array<{ day: string; orders: number; total: number }>;
  channels: Array<{ channel: WorldChannel; orders: number; total: number }>;
  /** `image`: the product's photo at an address on this site (the app's own image route), or null when it has none. */
  topProducts: Array<{ id: string; name: string; family: string; units: number; image: string | null }>;
  recentOrders: WorldOrder[];
};

export type WorldCustomers = {
  total: number;
  newInWindow: number;
  /** Customers with an order that is not cancelled in the last 90 days, consignment partners left out. */
  buyers90: number;
  debtors: number;
  /** What customers still owe, the dashboard's «مطالبات». */
  receivables: number;
  /** The best customers of the last 90 days by what they paid for, consignment partners left out. */
  top: Array<{ id: string; name: string; orders: number; spend: number; debt: number }>;
  /**
   * Every customer (partners left out) by what they ever bought, in tiers (customerTier): 1 الماسی …
   * 5 عادی, 6 never bought. The world houses each tier its own way.
   */
  people: WorldCustomer[];
  tiers: Array<{ tier: CustomerTier; label: string; count: number }>;
};

export type CustomerTier = 1 | 2 | 3 | 4 | 5 | 6;

/** debt: what they still owe us on their orders. credit: what we owe them (their credit account, and paid beyond an order). */
export type WorldCustomer = { id: string; name: string; spend: number; orders: number; debt: number; credit: number; lastAt: string | null; tier: CustomerTier };

export type WorldSupplier = {
  id: string;
  name: string;
  orders: number;
  /** Purchase orders not yet received or cancelled. */
  open: number;
  lastOrderAt: string | null;
  /** finance.view only: still to pay on its purchase orders, in Toman. */
  unpaid?: number;
  /** finance.view only: what its purchase orders came to, in Toman, cancelled ones left out. */
  volume?: number;
  /** finance.view only: the credit it holds for us (supplier credit: goods or money it owes us). */
  credit?: number;
};

export type WorldSuppliers = {
  suppliers: WorldSupplier[];
  /** finance.view only: the dashboard's «بدهی به تامین‌کنندگان». */
  payables?: number;
};

export type WorldSite = {
  host: string | null;
  stockPush: boolean;
  productsOnSite: number;
  hook: { lastOkAt: string | null; failingSince: string | null; paused: boolean };
  catalogue: { at: string | null; ok: boolean | null; read: number; updated: number; notInErp: number };
  /** sales.view only: website orders in the sales window. */
  orders?: { count: number; total: number };
};

export type WorldAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  /** The balance in Toman at the latest rate; null for a currency with no rate. */
  toman: number | null;
};

export type WorldFinance = {
  /** «موجودی کل»: every account that holds money, foreign ones at the latest rate. */
  total: number;
  accounts: WorldAccount[];
  receivables: number;
  payables: number;
  /** The sales window's revenue and expenses by category (profit and loss's rule); cost of goods only with cost.view. */
  flows: { income: Array<{ category: string; amount: number }>; expense: Array<{ category: string; amount: number }> };
};

export type WorldProfit = { revenue: number; cogs: number; expenses: number; profit: number };

export type WorldOffice = {
  projects: number;
  tasks: { open: number; overdue: number; done: number };
};

export type WorldEvent = {
  id: string;
  kind: 'order' | 'transfer' | 'purchase' | 'return' | 'adjust' | 'sale' | 'income' | 'expense';
  at: string;
  from: WorldPlace;
  to: WorldPlace;
  label: string;
  units?: number;
  amount?: number;
};

export type WorldData = {
  generatedAt: string;
  layers: WorldLayers;
  stock?: WorldStock;
  sales?: WorldSales;
  customers?: WorldCustomers;
  suppliers?: WorldSuppliers;
  site?: WorldSite;
  finance?: WorldFinance;
  profit?: WorldProfit;
  office: WorldOffice;
  /** The last 7 days, newest first. */
  events: WorldEvent[];
};
