/**
 * What the business world says about each thing on its map: the card shown on
 * hover and when it is picked. Pure, from the snapshot alone, so a figure a role
 * may not see is never shown (it is not in the snapshot to begin with).
 */
import { tomanTick } from '@/lib/chart-format';
import { DISTRICT_LABELS, type CityPlan, type DistrictKey } from '@/components/world/world-city';
import type { CustomerTier, WorldChannel, WorldData, WorldEvent } from '@/lib/world-types';

export const TIER_NAMES: Record<CustomerTier, string> = { 1: 'الماسی', 2: 'طلایی', 3: 'نقره‌ای', 4: 'برنزی', 5: 'عادی', 6: 'بی‌خرید' };
const HOME_NAMES: Record<string, string> = { mansion: 'عمارت', villa: 'ویلا', house: 'خانه', terrace: 'خانه‌های شهری', apartment: 'آپارتمان شهرک' };

export type Card = { title: string; subtitle?: string; rows: Array<[string, string]>; href?: string; tone?: 'good' | 'warn' | 'bad' };

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
const toman = (n: number) => `${fa(n)} تومان`;
export const short = (n: number) => tomanTick(n);

export const CHANNEL_LABELS: Record<WorldChannel, string> = { site: 'وب‌سایت', shop: 'فروش حضوری', consignment: 'امانی' };

const ORDER_STATUS: Record<string, string> = { COMPLETED: 'تکمیل', PENDING: 'در انتظار', CANCELLED: 'لغو شده', PROCESSING: 'در جریان' };
const PAYMENT_STATUS: Record<string, string> = { PAID: 'پرداخت‌شده', UNPAID: 'پرداخت‌نشده', PARTIAL: 'پرداخت جزئی' };
const ACCOUNT_TYPES: Record<string, string> = { BANK: 'بانک', CASH: 'صندوق', PERSON: 'شخص', CRYPTO: 'کیف پول دیجیتال' };

const dateFa = (iso: string) => new Date(iso).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });

/** «۵ دقیقه پیش», «۲ ساعت پیش», «۳ روز پیش». */
export function ago(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${fa(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${fa(hours)} ساعت پیش`;
  return `${fa(Math.round(hours / 24))} روز پیش`;
}

export const EVENT_LABELS: Record<WorldEvent['kind'], string> = {
  order: 'سفارش',
  transfer: 'انتقال کالا',
  purchase: 'رسید خرید',
  return: 'مرجوعی',
  adjust: 'اصلاح موجودی',
  sale: 'خروج برای فروش',
  income: 'واریز',
  expense: 'هزینه',
};

export function districtCard(key: DistrictKey, data: WorldData): Card {
  const title = DISTRICT_LABELS[key];
  switch (key) {
    case 'hq': {
      const rows: Array<[string, string]> = [];
      if (data.sales) rows.push(['فروش امروز', `${toman(data.sales.today.total)} · ${fa(data.sales.today.orders)} سفارش`]);
      if (data.sales) rows.push(['فروش ۳۰ روز', `${toman(data.sales.window.total)} · ${fa(data.sales.window.orders)} سفارش`]);
      if (data.profit) rows.push(['سود ۳۰ روز', toman(data.profit.profit)]);
      if (data.finance) rows.push(['موجودی کل', toman(data.finance.total)]);
      if (data.stock) rows.push(['موجودی کالا', `${fa(data.stock.totals.units)} عدد از ${fa(data.stock.totals.products)} کالا`]);
      rows.push(['پروژه‌های باز', fa(data.office.projects)]);
      return { title, subtitle: 'نمای کلی کسب‌وکار', rows, href: '/dashboard' };
    }
    case 'treasury': {
      const f = data.finance!;
      return {
        title,
        subtitle: 'حساب‌ها و جریان پول ۳۰ روز اخیر',
        rows: [
          ['موجودی کل', toman(f.total)],
          ['مطالبات از مشتری‌ها', toman(f.receivables)],
          ['بدهی به تأمین‌کننده‌ها', toman(f.payables)],
          ['درآمد ۳۰ روز', toman(f.flows.income.reduce((s, r) => s + r.amount, 0))],
          ['هزینه ۳۰ روز', toman(f.flows.expense.reduce((s, r) => s + r.amount, 0))],
        ],
        href: '/dashboard/accounting',
      };
    }
    case 'warehouse':
    case 'consignment': {
      const s = data.stock!;
      const list = s.warehouses.filter((w) => w.virtual === (key === 'consignment'));
      const rows: Array<[string, string]> = list.map((w) => [w.partner ?? w.name, `${fa(w.units)} عدد`]);
      if (key === 'warehouse') rows.push(['کالای کم (≤ ۳)', fa(s.totals.low)], ['ناموجود', fa(s.totals.out)]);
      return { title, subtitle: `${fa(list.length)} ${key === 'consignment' ? 'فروشگاه' : 'انبار'}`, rows, href: key === 'consignment' ? '/dashboard/consignment' : '/dashboard/inventory' };
    }
    case 'site':
      return siteCard(data);
    case 'market': {
      const sales = data.sales!;
      return {
        title,
        subtitle: 'فروش ۳۰ روز اخیر به تفکیک کانال',
        rows: [
          ...sales.channels.map((c): [string, string] => [CHANNEL_LABELS[c.channel], `${toman(c.total)} · ${fa(c.orders)} سفارش`]),
          ['پرفروش‌ترین', sales.topProducts[0] ? `${sales.topProducts[0].name} (${fa(sales.topProducts[0].units)})` : '—'],
        ],
        href: '/dashboard/sales',
      };
    }
    case 'customers': {
      const c = data.customers!;
      return {
        title,
        subtitle: `${fa(c.total)} مشتری`,
        rows: [
          ['خرید در ۹۰ روز', `${fa(c.buyers90)} نفر`],
          ['مشتری تازه در ۳۰ روز', fa(c.newInWindow)],
          ['بدهکار', `${fa(c.debtors)} نفر · ${toman(c.receivables)}`],
          ...c.tiers.filter((t) => t.count > 0).map((t): [string, string] => [`مشتری ${t.label}`, `${fa(t.count)} نفر`]),
        ],
        href: '/dashboard/crm',
      };
    }
    case 'suppliers': {
      const s = data.suppliers!;
      const rows: Array<[string, string]> = [['تأمین‌کننده', fa(s.suppliers.length)], ['سفارش خرید باز', fa(s.suppliers.reduce((n, x) => n + x.open, 0))]];
      if (s.payables !== undefined) rows.push(['بدهی', toman(s.payables)]);
      return { title, rows, href: '/dashboard/suppliers' };
    }
    case 'port': {
      const purchases = data.events.filter((e) => e.kind === 'purchase');
      const rows: Array<[string, string]> = [['رسید خرید در ۷ روز', fa(purchases.length)]];
      if (data.suppliers) rows.push(['سفارش خرید باز', fa(data.suppliers.suppliers.reduce((n, x) => n + x.open, 0))]);
      if (data.suppliers?.payables !== undefined) rows.push(['بدهی به تأمین‌کننده‌ها', toman(data.suppliers.payables)]);
      return { title, subtitle: 'کالا از چین با کشتی و هواپیما به این بندر می‌رسد', rows, href: '/dashboard/suppliers' };
    }
    case 'office':
      return {
        title,
        rows: [
          ['پروژه‌های باز', fa(data.office.projects)],
          ['کارهای باز', fa(data.office.tasks.open)],
          ['عقب‌افتاده', fa(data.office.tasks.overdue)],
          ['انجام‌شده', fa(data.office.tasks.done)],
        ],
        href: '/dashboard/projects',
        tone: data.office.tasks.overdue > 0 ? 'warn' : undefined,
      };
  }
}

function siteCard(data: WorldData): Card {
  const s = data.site!;
  const failing = s.hook.paused || !!s.hook.failingSince;
  const rows: Array<[string, string]> = [
    ['نشانی', s.host ?? 'وصل نشده'],
    ['کالاهای روی سایت', fa(s.productsOnSite)],
    ['ارسال موجودی به سایت', s.stockPush ? (failing ? 'خطا دارد' : 'فعال') : 'خاموش'],
    ['آخرین ارسال موفق', s.hook.lastOkAt ? ago(s.hook.lastOkAt) : '—'],
    ['آخرین خواندن کاتالوگ', s.catalogue.at ? `${ago(s.catalogue.at)} · ${fa(s.catalogue.read)} کالا` : '—'],
  ];
  if (s.catalogue.notInErp) rows.push(['کالای سایت که در ERP نیست', fa(s.catalogue.notInErp)]);
  if (s.orders) rows.push(['سفارش سایت در ۳۰ روز', `${fa(s.orders.count)} · ${toman(s.orders.total)}`]);
  return { title: DISTRICT_LABELS.site, rows, href: '/dashboard/settings/site', tone: failing ? 'bad' : 'good' };
}

/** The card of a thing on the map, by its id (see world-engine.ts), or null when it is gone. */
export function thingCard(id: string, data: WorldData, plan?: CityPlan | null): Card | null {
  const [kind, a, b] = id.split(':');
  if (kind === 'district') return districtCard(a as DistrictKey, data);
  if (kind === 'warehouse') {
    const w = data.stock?.warehouses.find((x) => x.id === a);
    if (!w) return null;
    const rows: Array<[string, string]> = [['موجودی', `${fa(w.units)} عدد`], ['تعداد کالا', fa(w.products)]];
    if (w.sales90 !== undefined) rows.push(['فروش ۹۰ روز', toman(w.sales90)]);
    if (w.receivable) rows.push(['طلب ما از او', toman(w.receivable)]);
    if (w.payable) rows.push(['بدهی ما به او', toman(w.payable)]);
    if (w.valueAtCost !== undefined) rows.push(['ارزش به قیمت تمام‌شده', toman(w.valueAtCost)]);
    return { title: w.partner ?? w.name, subtitle: w.virtual ? `فروشگاه امانی · ${w.name}` : 'انبار', rows, href: `/dashboard/inventory/warehouses/${w.id}` };
  }
  if (kind === 'product') {
    const p = data.stock?.products.find((x) => x.id === b);
    const w = data.stock?.warehouses.find((x) => x.id === a);
    if (!p) return null;
    const rows: Array<[string, string]> = [
      ['در این انبار', `${fa(Math.max(0, p.byWarehouse[a] ?? 0))} عدد`],
      ['موجودی کل', `${fa(p.units)} عدد`],
    ];
    if (p.sold !== undefined) rows.push(['فروش ۳۰ روز', `${fa(p.sold)} عدد`]);
    rows.push(['روی سایت', p.onSite ? 'هست' : 'نیست']);
    return {
      title: p.name,
      subtitle: w ? (w.partner ?? w.name) : undefined,
      rows,
      href: `/dashboard/inventory/products/${p.id}`,
      tone: p.level === 'OUT' ? 'bad' : p.level === 'LOW' ? 'warn' : undefined,
    };
  }
  if (kind === 'account') {
    const acc = data.finance?.accounts.find((x) => x.id === a);
    if (!acc) return null;
    const rows: Array<[string, string]> = [['موجودی', acc.currency === 'TOMAN' ? toman(acc.balance) : `${acc.balance.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} ${acc.currency}`]];
    if (acc.currency !== 'TOMAN') rows.push(['به تومان', acc.toman === null ? 'نرخی ثبت نشده' : toman(acc.toman)]);
    return { title: acc.name, subtitle: ACCOUNT_TYPES[acc.type] ?? acc.type, rows, href: '/dashboard/accounting/accounts', tone: acc.balance < 0 ? 'bad' : undefined };
  }
  if (kind === 'flow') {
    const list = a === 'income' ? data.finance?.flows.income : data.finance?.flows.expense;
    const row = list?.find((x) => x.category === id.slice(`flow:${a}:`.length));
    if (!row) return null;
    return { title: row.category, subtitle: a === 'income' ? 'درآمد ۳۰ روز' : 'هزینه ۳۰ روز', rows: [['مبلغ', toman(row.amount)]], tone: a === 'income' ? 'good' : 'bad' };
  }
  if (kind === 'channel') {
    const c = data.sales?.channels.find((x) => x.channel === a);
    if (!c) return null;
    return { title: CHANNEL_LABELS[c.channel], subtitle: 'فروش ۳۰ روز', rows: [['مبلغ', toman(c.total)], ['سفارش', fa(c.orders)]], href: '/dashboard/sales' };
  }
  if (kind === 'top') {
    const p = data.sales?.topProducts.find((x) => x.id === a);
    if (!p) return null;
    const rank = data.sales!.topProducts.indexOf(p) + 1;
    return { title: p.name, subtitle: `رتبهٔ ${fa(rank)} فروش ۳۰ روز`, rows: [['فروش', `${fa(p.units)} عدد`]], href: `/dashboard/inventory/products/${p.id}` };
  }
  if (kind === 'day') {
    const d = data.sales?.days.find((x) => x.day === a);
    if (!d) return null;
    return { title: dateFa(`${d.day}T12:00:00+03:30`), subtitle: 'فروش روز', rows: [['مبلغ', toman(d.total)], ['سفارش', fa(d.orders)]] };
  }
  if (kind === 'supplier') {
    const s = data.suppliers?.suppliers.find((x) => x.id === a);
    if (!s) return null;
    const rows: Array<[string, string]> = [['سفارش خرید', fa(s.orders)], ['باز', fa(s.open)], ['آخرین سفارش', s.lastOrderAt ? dateFa(s.lastOrderAt) : '—']];
    if (s.volume !== undefined) rows.push(['کل خرید از او', toman(s.volume)]);
    if (s.unpaid !== undefined) rows.push(['بدهی ما به او', toman(s.unpaid)]);
    if (s.credit) rows.push(['طلب ما از او', toman(s.credit)]);
    return { title: s.name, subtitle: 'تأمین‌کننده', rows, href: '/dashboard/suppliers', tone: s.unpaid ? 'warn' : undefined };
  }
  if (kind === 'customer') {
    const c = data.customers?.people.find((x) => x.id === a);
    if (!c) return null;
    const rows: Array<[string, string]> = [['کل خرید', toman(c.spend)], ['سفارش', fa(c.orders)], ['طلب ما', c.debt ? toman(c.debt) : 'ندارد'], ['بدهی ما', c.credit ? toman(c.credit) : 'ندارد']];
    if (c.lastAt) rows.push(['آخرین خرید', ago(c.lastAt)]);
    return {
      title: c.name,
      subtitle: `مشتری ${TIER_NAMES[c.tier]}`,
      rows,
      href: `/dashboard/crm/customers/${c.id}`,
      tone: c.debt ? 'warn' : undefined,
    };
  }
  if (kind === 'home') {
    const home = plan?.homes.find((h) => `home:${h.id}` === id);
    const people = data.customers?.people ?? [];
    if (!home) return null;
    const residents = home.residents.map((r) => people.find((p) => p.id === r)).filter((p): p is NonNullable<typeof p> => !!p);
    const debt = residents.reduce((s, r) => s + r.debt, 0);
    const credit = residents.reduce((s, r) => s + r.credit, 0);
    return {
      title: HOME_NAMES[home.kind] ?? 'خانه',
      subtitle: `${fa(residents.length)} مشتری ${[...new Set(residents.map((r) => TIER_NAMES[r.tier]))].join('، ')}`,
      rows: [
        ['کل خرید', toman(residents.reduce((s, r) => s + r.spend, 0))],
        ['طلب ما', debt ? toman(debt) : 'ندارد'],
        ['بدهی ما', credit ? toman(credit) : 'ندارد'],
        ['خرید در ۹۰ روز', `${fa(residents.filter((r) => r.lastAt && Date.parse(r.lastAt) > Date.now() - 90 * 86_400_000).length)} نفر`],
        ...residents.slice(0, 8).map((r): [string, string] => [r.name, r.spend ? short(r.spend) : '—']),
      ],
      href: '/dashboard/crm',
      tone: debt ? 'warn' : undefined,
    };
  }
  if (kind === 'crowd') {
    const c = data.customers;
    if (!c) return null;
    return { title: 'بقیهٔ مشتری‌ها', rows: [['همهٔ مشتری‌ها', fa(c.total)], ['خرید در ۹۰ روز', fa(c.buyers90)]], href: '/dashboard/crm' };
  }
  if (kind === 'site') return data.site ? siteCard(data) : null;
  if (kind === 'port') return districtCard('port', data);
  if (kind === 'office') return districtCard('office', data);
  if (kind === 'out') {
    const total = data.finance?.flows.expense.reduce((s, r) => s + r.amount, 0);
    return total === undefined ? null : { title: 'خروجی هزینه‌ها', subtitle: '۳۰ روز اخیر', rows: [['جمع هزینه', toman(total)]], tone: 'bad' };
  }
  if (kind === 'kpi') {
    if (a === 'today' && data.sales) return { title: 'فروش امروز', rows: [['مبلغ', toman(data.sales.today.total)], ['سفارش', fa(data.sales.today.orders)]] };
    if (a === 'profit' && data.profit) return {
      title: 'سود ۳۰ روز',
      rows: [['درآمد', toman(data.profit.revenue)], ['بهای تمام‌شده', toman(data.profit.cogs)], ['هزینه‌ها', toman(data.profit.expenses)], ['سود', toman(data.profit.profit)]],
      tone: data.profit.profit >= 0 ? 'good' : 'bad',
    };
    if (a === 'balance' && data.finance) return { title: 'موجودی کل', rows: [['جمع', toman(data.finance.total)]] };
    if (a === 'stock' && data.stock) return { title: 'موجودی کالا', rows: [['عدد', fa(data.stock.totals.units)], ['کم', fa(data.stock.totals.low)], ['ناموجود', fa(data.stock.totals.out)]] };
    return null;
  }
  return null;
}

/** One line for an event in the activity feed. */
export function eventLine(event: WorldEvent): string {
  return event.amount !== undefined ? `${event.label} · ${short(event.amount)}` : event.label;
}
