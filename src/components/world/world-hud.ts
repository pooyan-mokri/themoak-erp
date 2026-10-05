/**
 * What the business world's panels (world-client.tsx) read from a snapshot:
 * today's problems, a past day for the time machine, the search, the order
 * tracker's steps. Pure, from the snapshot alone, so a role only ever sees
 * what its snapshot holds.
 */
import { stockLevel } from '@/lib/stock-levels';
import { balancesAt, stockAt, type WorldHistory } from '@/lib/world-history';
import type { WorldData, WorldOrder } from '@/lib/world-types';

export type Issue = { key: string; tone: 'bad' | 'warn'; title: string; detail: string; target: string };

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');

/** Today's problems, the worst first: each with the place on the map it is about. */
export function buildIssues(data: WorldData): Issue[] {
  const issues: Issue[] = [];
  const stock = data.stock;
  const main = stock?.warehouses.find((w) => !w.virtual);
  if (stock) {
    for (const p of stock.products) {
      if (p.level === 'OK') continue;
      const where = p.level === 'OUT' ? main?.id : Object.entries(p.byWarehouse).sort((a, b) => b[1] - a[1])[0]?.[0] ?? main?.id;
      const store = stock.warehouses.find((w) => w.id === where);
      const target = store?.virtual ? `warehouse:${store.id}` : `product:${where}:${p.id}`;
      issues.push({
        key: `stock:${p.id}`,
        tone: p.level === 'OUT' ? 'bad' : 'warn',
        title: p.name,
        detail: p.level === 'OUT' ? 'ناموجود' : `فقط ${fa(p.units)} عدد مانده`,
        target,
      });
    }
  }
  if (data.site && (data.site.hook.paused || data.site.hook.failingSince)) {
    issues.push({ key: 'site', tone: 'bad', title: 'ارسال موجودی به سایت', detail: data.site.hook.paused ? 'متوقف شده' : 'خطا دارد', target: 'site' });
  }
  if (data.office.tasks.overdue > 0) {
    issues.push({ key: 'tasks', tone: 'warn', title: 'کارهای عقب‌افتاده', detail: `${fa(data.office.tasks.overdue)} کار`, target: 'office' });
  }
  for (const c of data.customers?.top ?? []) {
    if (c.debt > 0) issues.push({ key: `debt:${c.id}`, tone: 'warn', title: c.name, detail: `بدهی ${fa(c.debt)} تومان`, target: `customer:${c.id}` });
  }
  for (const s of data.suppliers?.suppliers ?? []) {
    if (s.unpaid) issues.push({ key: `unpaid:${s.id}`, tone: 'warn', title: s.name, detail: `مانده پرداخت ${fa(s.unpaid)} تومان`, target: `supplier:${s.id}` });
  }
  return issues.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
}

/**
 * The world as it stood at the end of a past day (src/lib/world-history.ts): stock and balances walked
 * back from today's, the day's sales as «today». What the history does not cover stays as it is now.
 */
export function dayView(data: WorldData, history: WorldHistory, index: number): WorldData {
  const end = history.ends[index];
  const day = history.days[index];
  const view: WorldData = { ...data, generatedAt: end };
  if (data.stock && history.moves) {
    const rows = stockAt(data.stock.products, history.moves, end);
    const products = data.stock.products.map((p) => {
      const byWarehouse = rows.get(p.id) ?? {};
      const units = Object.values(byWarehouse).reduce((s, q) => s + q, 0);
      return { ...p, byWarehouse, units, level: stockLevel(units) };
    });
    const warehouses = data.stock.warehouses.map((w) => {
      const here = products.map((p) => p.byWarehouse[w.id] ?? 0);
      return { ...w, units: here.reduce((s, q) => s + q, 0), products: here.filter((q) => q > 0).length };
    });
    view.stock = {
      ...data.stock,
      products,
      warehouses,
      totals: {
        ...data.stock.totals,
        units: products.reduce((s, p) => s + p.units, 0),
        low: products.filter((p) => p.level === 'LOW').length,
        out: products.filter((p) => p.level === 'OUT').length,
      },
    };
  }
  if (data.finance && history.changes) {
    const balances = balancesAt(data.finance.accounts, history.changes, end);
    const accounts = data.finance.accounts.map((a) => {
      const balance = balances.get(a.id) ?? a.balance;
      const rate = a.currency === 'TOMAN' ? 1 : a.toman !== null && a.balance ? a.toman / a.balance : null;
      return { ...a, balance, toman: rate === null ? null : balance * rate };
    });
    view.finance = { ...data.finance, accounts, total: accounts.reduce((s, a) => s + (a.toman ?? 0), 0) };
  }
  if (data.sales) {
    const row = data.sales.days.find((d) => d.day === day);
    view.sales = { ...data.sales, today: { orders: row?.orders ?? 0, total: row?.total ?? 0 } };
  }
  const start = index > 0 ? history.ends[index - 1] : '';
  view.events = data.events.filter((e) => e.at < end && e.at >= start);
  return view;
}

export type SearchHit = { id: string; title: string; kind: string };

/** Everything on the map whose name contains the query, at most `limit`. */
export function searchWorld(data: WorldData, query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  const match = (text: string | null | undefined) => !!text && text.toLowerCase().includes(q);
  const main = data.stock?.warehouses.find((w) => !w.virtual);
  for (const w of data.stock?.warehouses ?? []) if (match(w.name) || match(w.partner)) hits.push({ id: `warehouse:${w.id}`, title: w.partner ?? w.name, kind: w.virtual ? 'فروشگاه امانی' : 'انبار' });
  for (const p of data.stock?.products ?? []) {
    if (!match(p.name)) continue;
    const where = Object.entries(p.byWarehouse).find(([id, q2]) => q2 > 0 && !data.stock!.warehouses.find((w) => w.id === id)?.virtual)?.[0] ?? main?.id;
    hits.push({ id: `product:${where}:${p.id}`, title: p.name, kind: 'کالا' });
  }
  for (const c of data.customers?.top ?? []) if (match(c.name)) hits.push({ id: `customer:${c.id}`, title: c.name, kind: 'مشتری' });
  for (const s of data.suppliers?.suppliers ?? []) if (match(s.name)) hits.push({ id: `supplier:${s.id}`, title: s.name, kind: 'تأمین‌کننده' });
  for (const a of data.finance?.accounts ?? []) if (match(a.name)) hits.push({ id: `account:${a.id}`, title: a.name, kind: 'حساب' });
  return hits.slice(0, limit);
}

export type Step = { label: string; state: 'done' | 'now' | 'todo' | 'off'; note?: string };

/** An order's way from placed to delivered, for the tracker. */
export function orderSteps(order: WorldOrder): Step[] {
  const cancelled = order.status === 'CANCELLED';
  const done = order.status === 'COMPLETED';
  const paid = order.paymentStatus === 'PAID';
  const partial = order.paymentStatus === 'PARTIAL';
  const time = new Date(order.createdAt).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });
  const step = (label: string, ok: boolean, now: boolean, note?: string): Step => ({ label, state: cancelled ? 'off' : ok ? 'done' : now ? 'now' : 'todo', note });
  return [
    { label: 'ثبت سفارش', state: 'done', note: time },
    step('پرداخت', paid, partial || !paid, partial ? 'جزئی' : undefined),
    step('آماده‌سازی', done || order.status === 'PROCESSING', paid && !done),
    step(order.channel === 'site' ? 'ارسال' : order.channel === 'consignment' ? 'فروش امانی' : 'تحویل حضوری', done, false),
    step('تکمیل', done, false),
  ];
}

/** A short, pleasant chime for a sale that just happened (WebAudio, no files). */
export function chime(context: AudioContext) {
  const now = context.currentTime;
  for (const [i, freq] of [1318.5, 1760].entries()) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.11);
    gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.11 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.6);
    osc.connect(gain).connect(context.destination);
    osc.start(now + i * 0.11);
    osc.stop(now + i * 0.11 + 0.65);
  }
}

export type Weather = 'sunny' | 'cloudy' | 'rain';

/** How much daylight there is at an hour: 0 at night, 1 at midday, a soft dawn and dusk. */
export function daylight(hour: number): number {
  const rise = 6.3;
  const set = 17.9;
  if (hour <= rise - 0.7 || hour >= set + 0.7) return 0;
  if (hour < rise + 0.7) return (hour - (rise - 0.7)) / 1.4;
  if (hour > set - 0.7) return ((set + 0.7) - hour) / 1.4;
  return 1;
}

/** The weather the business has: from the sales of this window against the one before. */
export function businessWeather(data: Pick<WorldData, 'sales'>): { weather: Weather; change: number | null; rainbow: boolean } {
  const s = data.sales;
  if (!s) return { weather: 'sunny', change: null, rainbow: false };
  const before = s.previous?.total ?? 0;
  const change = before > 0 ? (s.window.total - before) / before : null;
  const weather: Weather = change === null || change >= 0.05 ? 'sunny' : change > -0.05 ? 'cloudy' : 'rain';
  const best = Math.max(0, ...s.days.map((d) => d.total));
  const rainbow = best > 0 && (s.days[s.days.length - 1]?.total ?? 0) >= best;
  return { weather, change, rainbow };
}
