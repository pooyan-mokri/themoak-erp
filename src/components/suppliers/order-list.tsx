'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { CURRENCY_LABELS, PAID_AT_RATE_NOTE, PURCHASE_STATUSES, awaitsReceipt, foreignTotalOf, isOpen, payableOf, purchaseStatus, tomanValueOf } from './purchase-figures';

interface PurchaseOrder {
  id: string;
  number: number;
  supplier: { name: string };
  totalAmount?: any;
  totalAmountInToman?: any;
  paidAmountInToman?: number;
  unpaidInToman?: number;
  status: string;
  createdAt: Date;
  items: any[];
}

interface OrderListProps {
  orders: PurchaseOrder[];
  warehouses: { id: string; name: string }[];
  /** Order totals (finance.view). */
  canSeeFinance: boolean;
  /** New orders set prices (cost.edit). */
  canCreate: boolean;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
// A supplier's price may have cents (¥12.50); Toman never does.
const faForeign = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(n);

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  { id: 'open', label: 'باز', match: (o: PurchaseOrder) => isOpen(o) },
  { id: 'payment', label: 'منتظر پرداخت', match: (o: PurchaseOrder) => o.status === 'PENDING_PAYMENT' || o.status === 'PARTIALLY_PAID' },
  { id: 'production', label: 'در حال تولید', match: (o: PurchaseOrder) => o.status === 'IN_PRODUCTION' },
  { id: 'arrived', label: 'منتظر دریافت', match: (o: PurchaseOrder) => awaitsReceipt(o) },
  { id: 'received', label: 'دریافت شده', match: (o: PurchaseOrder) => o.status === 'RECEIVED' },
] as const;

type SortKey = 'number' | 'supplier' | 'total' | 'remaining' | 'createdAt';
const PAGE_SIZE = 25;

export function OrderList({ orders, canSeeFinance }: OrderListProps) {
  const router = useRouter();
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(0);

  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = orders.filter((o) => {
      if (!currentView.match(o)) return false;
      if (status !== 'all' && o.status !== status) return false;
      if (!q) return true;
      return (
        String(o.number).includes(q) ||
        `po-${o.number}`.includes(q) ||
        o.supplier.name.toLowerCase().includes(q) ||
        o.items.some((i: any) => i.product?.name?.toLowerCase().includes(q) || i.product?.sku?.toLowerCase().includes(q))
      );
    });
    const value = (o: PurchaseOrder): number | string =>
      sort.key === 'number' ? o.number
      : sort.key === 'supplier' ? o.supplier.name
      : sort.key === 'total' ? tomanValueOf(o)
      : sort.key === 'remaining' ? payableOf(o) ?? 0
      : new Date(o.createdAt).getTime();
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * dir);
  }, [orders, currentView, status, query, sort]);

  useEffect(() => setPage(0), [view, status, query, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const SortHead = ({ k, children, end }: { k: SortKey; children: React.ReactNode; end?: boolean }) => (
    <th className={cn('h-9 bg-secondary px-3 text-xs font-normal text-muted-foreground', end ? 'text-end' : 'text-start')}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.key === k && (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
              view === v.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
            )}
          >
            {v.label}
            <span className="font-mono text-[11px] opacity-70">{fa(orders.filter(v.match).length)}</span>
          </button>
        ))}
        <div className="flex-1" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه وضعیت‌ها</SelectItem>
            {Object.entries(PURCHASE_STATUSES).map(([value, s]) => (
              <SelectItem key={value} value={value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="شماره، تامین‌کننده یا کالا" className="ps-8" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <SortHead k="number">شماره</SortHead>
                <SortHead k="supplier">تامین‌کننده</SortHead>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">اقلام</th>
                {canSeeFinance && <SortHead k="total" end>مبلغ کل</SortHead>}
                {canSeeFinance && <SortHead k="remaining" end>مانده پرداخت</SortHead>}
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
                <SortHead k="createdAt">تاریخ ثبت</SortHead>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="h-24 text-center text-[13px] text-muted-foreground">
                    {orders.length === 0 ? (
                      'هنوز سفارش خریدی ثبت نشده است. سفارش خرید با «سفارش جدید» و قیمت‌های تامین‌کننده ثبت می‌شود.'
                    ) : (
                      <>
                        سفارشی با این نما و جستجو پیدا نشد.{' '}
                        <button
                          className="text-brand hover:underline"
                          onClick={() => {
                            setView('all');
                            setStatus('all');
                            setQuery('');
                          }}
                        >
                          نمایش همه
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {pageRows.map((order) => {
                const s = purchaseStatus(order.status);
                const remaining = payableOf(order) ?? 0;
                const units = order.items.reduce((sum: number, i: any) => sum + (i.quantity ?? 0), 0);
                const currencies = Array.from(new Set(order.items.map((i: any) => i.currency).filter((c: string) => c && c !== 'TOMAN')));
                // Recorded in the supplier's currency: no Toman total until it is paid.
                const foreign = foreignTotalOf(order);
                return (
                  <tr
                    key={order.id}
                    onClick={() => router.push(`/dashboard/suppliers/orders/${order.id}`)}
                    className="h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]"
                  >
                    <td className="px-3">
                      <Link
                        href={`/dashboard/suppliers/orders/${order.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono font-bold hover:text-brand"
                      >
                        PO-{order.number}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-3 font-medium">{order.supplier.name}</td>
                    <td className="px-3 text-[12.5px] text-muted-foreground">
                      {fa(order.items.length)} ردیف · {fa(units)} عدد
                      {currencies.length > 0 && <span className="ms-1 font-mono text-[11px]">{currencies.join(' ')}</span>}
                    </td>
                    {canSeeFinance && (
                      <td className="px-3 text-end font-medium tabular-nums">
                        {foreign ? (
                          <>
                            {faForeign(foreign.amount)} <small className="text-[11px] font-normal text-muted-foreground">{CURRENCY_LABELS[foreign.currency] ?? foreign.currency}</small>
                            <span className="block text-[11px] font-normal text-muted-foreground">{PAID_AT_RATE_NOTE}</span>
                          </>
                        ) : (
                          fa(tomanValueOf(order))
                        )}
                      </td>
                    )}
                    {canSeeFinance && (
                      <td className="px-3 text-end tabular-nums text-muted-foreground">{remaining > 0 ? fa(remaining) : '—'}</td>
                    )}
                    <td className="px-3">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', s.tone)}>{s.label}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px] text-muted-foreground">{formatJalaliDate(order.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-muted-foreground">
            <span>
              {fa(page * PAGE_SIZE + 1)} تا {fa(Math.min(rows.length, (page + 1) * PAGE_SIZE))} از {fa(rows.length)}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                قبلی
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                بعدی
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
