'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, Download, Plus, Search, SlidersHorizontal, Wallet, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { formatJalaliDate, formatJalaliDateTime } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { PaymentDialog } from './payment-dialog';
import { cancelOrder, getCancelOrderPreview } from '@/actions/sales';

type Customer = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  wooId?: number;
  taxId?: string;
  segment?: string;
  creditLimit?: number;
  commissionRate?: number;
  createdAt: Date;
  updatedAt: Date;
  type: string;
  paymentTerms: number;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  costPrice: number;
  sellPrice: number;
  image?: string;
  wooId?: number;
  barcode?: string;
  createdAt: Date;
  updatedAt: Date;
  productType: string;
};

type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
  status: string;
  product: Product;
  warehouse?: { id: string; name: string } | null;
};

type OrderWithDetails = {
  id: string;
  number: number;
  createdAt: Date;
  updatedAt: Date;
  wooId?: number;
  customerId?: string;
  status: string;
  totalAmount: number;
  transactionId?: string;
  discount?: number;
  paidAmount?: number;
  paymentStatus: string;
  invoiceId?: string;
  tags?: string[];
  siteReference?: string | null;
  customer?: Customer;
  items: OrderItem[];
};

interface OrderListProps {
  orders: OrderWithDetails[];
  /** May record payments, cancel and start a sale (sales.manage). */
  canManage?: boolean;
}

/** One account's line in the cancel confirmation: what the cancel does to its balance. */
function describeReversal(account: { label: string; currency: string | null; change: number; rows: number; moves: boolean }) {
  const rows = `${account.rows.toLocaleString('fa-IR')} ردیف`;
  if (!account.moves || account.change === 0) return `  • ${account.label}: بدون تغییر موجودی (${rows})`;
  const unit = !account.currency || account.currency === 'TOMAN' ? 'تومان' : account.currency;
  const direction = account.change < 0 ? 'کم می‌شود' : 'اضافه می‌شود';
  return `  • ${account.label}: ${Math.abs(account.change).toLocaleString('fa-IR')} ${unit} ${direction} (${rows})`;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const finalOf = (o: OrderWithDetails) => Number(o.totalAmount) - Number(o.discount || 0);
const remainingOf = (o: OrderWithDetails) => finalOf(o) - Number(o.paidAmount || 0);
const unitsOf = (o: OrderWithDetails) => o.items.reduce((sum, item) => sum + item.quantity, 0);

/** Status is a colour and a word (design system §12): cancelled, or how far it is paid. */
function statusOf(o: OrderWithDetails): { label: string; tone: string } {
  if (o.status === 'CANCELLED') return { label: 'لغو شده', tone: 'bg-danger-soft text-danger' };
  if (o.paymentStatus === 'PAID') return { label: 'پرداخت شده', tone: 'bg-success-soft text-success' };
  if (o.paymentStatus === 'PARTIAL') return { label: 'پرداخت جزئی', tone: 'bg-brand-soft text-brand' };
  return { label: 'پرداخت نشده', tone: 'bg-warning-soft text-warning' };
}

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  {
    id: 'unpaid',
    label: 'پرداخت‌نشده',
    match: (o: OrderWithDetails) => o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID',
  },
  { id: 'site', label: 'سفارش‌های سایت', match: (o: OrderWithDetails) => !!o.siteReference },
  { id: 'store', label: 'فروشگاه', match: (o: OrderWithDetails) => !o.siteReference },
  { id: 'cancelled', label: 'لغو شده', match: (o: OrderWithDetails) => o.status === 'CANCELLED' },
] as const;

type SortKey = 'number' | 'createdAt' | 'customer' | 'final' | 'remaining';
const PAGE_SIZE = 25;

export function OrderList({ orders, canManage = false }: OrderListProps) {
  const router = useRouter();
  const [paying, setPaying] = useState<OrderWithDetails | null>(null);

  // Quick view, search and the advanced filters
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterFromDate, setFilterFromDate] = useState<Date | undefined>();
  const [filterToDate, setFilterToDate] = useState<Date | undefined>();
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(0);

  // Selection, keyboard cursor and the side panel
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [peekId, setPeekId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const warehouses = useMemo(() => {
    const map = new Map<string, string>();
    orders.forEach((o) => o.items.forEach((item) => item.warehouse && map.set(item.warehouse.id, item.warehouse.name)));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const hasActiveFilters = !!(filterFromDate || filterToDate || filterMinAmount || filterMaxAmount || filterWarehouse !== 'all');
  const resetFilters = () => {
    setFilterFromDate(undefined);
    setFilterToDate(undefined);
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setFilterWarehouse('all');
  };

  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = orders.filter((o) => {
      if (!currentView.match(o)) return false;
      if (q && !String(o.number).includes(q) && !(o.customer?.name ?? 'مشتری عمومی').toLowerCase().includes(q)) return false;
      if (filterFromDate) {
        const from = new Date(filterFromDate);
        from.setHours(0, 0, 0, 0);
        if (new Date(o.createdAt) < from) return false;
      }
      if (filterToDate) {
        const to = new Date(filterToDate);
        to.setHours(23, 59, 59, 999);
        if (new Date(o.createdAt) > to) return false;
      }
      if (filterMinAmount && finalOf(o) < Number(filterMinAmount)) return false;
      if (filterMaxAmount && finalOf(o) > Number(filterMaxAmount)) return false;
      if (filterWarehouse !== 'all' && !o.items.some((item) => item.warehouse?.id === filterWarehouse)) return false;
      return true;
    });
    const value = (o: OrderWithDetails): number | string =>
      sort.key === 'number' ? o.number
      : sort.key === 'createdAt' ? new Date(o.createdAt).getTime()
      : sort.key === 'customer' ? o.customer?.name ?? ''
      : sort.key === 'final' ? finalOf(o)
      : remainingOf(o);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * dir);
  }, [orders, currentView, query, filterFromDate, filterToDate, filterMinAmount, filterMaxAmount, filterWarehouse, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage(0);
    setCursor(0);
  }, [view, query, filterFromDate, filterToDate, filterMinAmount, filterMaxAmount, filterWarehouse, sort]);

  // Figures for what is on screen: never cancelled money.
  const live = filtered.filter((o) => o.status !== 'CANCELLED');
  const revenue = live.reduce((sum, o) => sum + finalOf(o), 0);
  const outstanding = live.filter((o) => remainingOf(o) > 0);
  const peek = peekId ? orders.find((o) => o.id === peekId) ?? null : null;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // J/K move, Enter opens the side panel, X selects, Esc closes — not while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (target?.closest('[role="dialog"]')) return;
      const row = pageRows[cursor];
      if (event.code === 'KeyJ' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(pageRows.length - 1, cursor + 1);
        setCursor(next);
        if (peekId && pageRows[next]) setPeekId(pageRows[next].id);
      } else if (event.code === 'KeyK' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, cursor - 1);
        setCursor(next);
        if (peekId && pageRows[next]) setPeekId(pageRows[next].id);
      } else if (event.key === 'Enter' && row) {
        event.preventDefault();
        setPeekId((id) => (id === row.id ? null : row.id));
      } else if (event.code === 'KeyX' && row) {
        event.preventDefault();
        toggle(row.id);
      } else if (event.key === 'Escape') {
        setPeekId(null);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageRows, cursor, peekId]);

  const handleCancelOrder = async (order: OrderWithDetails) => {
    // Show what the cancel will actually reverse, per account, as the server computes it.
    const preview = await getCancelOrderPreview(order.id);
    if (!preview.success) {
      toast.error(preview.message);
      return;
    }
    const money =
      preview.accounts.length === 0
        ? `- هیچ مبلغی از این سفارش در حساب‌ها ثبت نشده است\n`
        : `- این ردیف‌های مالی سفارش حذف و اثرشان از حساب‌ها برگردانده می‌شود:\n` +
          preview.accounts.map(describeReversal).join('\n') +
          '\n';
    const confirmed = window.confirm(
      `آیا مطمئن هستید که می‌خواهید سفارش #${order.number} را لغو کنید؟\n\n` +
        `این عملیات:\n` +
        `- وضعیت سفارش را به "لغو شده" تغییر می‌دهد\n` +
        money,
    );
    if (!confirmed) return;
    // Exactly the rows shown: if a payment was booked meanwhile, the server refuses.
    const result = await cancelOrder(order.id, preview.moneyRowIds);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  // Excel of what is selected, or else of what the filters show.
  const handleExport = () => {
    const rows = selected.size > 0 ? filtered.filter((o) => selected.has(o.id)) : filtered;
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((order) => ({
        'شماره سفارش': order.number,
        'مشتری': order.customer?.name || 'مشتری عمومی',
        'مبلغ کل (تومان)': Number(order.totalAmount),
        'تخفیف (تومان)': Number(order.discount || 0),
        'مبلغ پرداختی (تومان)': Number(order.paidAmount || 0),
        'باقیمانده (تومان)': remainingOf(order),
        'وضعیت': statusOf(order).label,
        'تعداد اقلام': unitsOf(order),
        'تاریخ': formatJalaliDateTime(order.createdAt),
        'منبع': order.siteReference ? 'سایت' : order.wooId ? 'WooCommerce' : 'فروشگاه',
        'تگ‌ها': (order.tags ?? []).join('، '),
      })),
    );
    sheet['!cols'] = [12, 20, 15, 15, 15, 15, 14, 12, 20, 12, 20].map((wch) => ({ wch }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'سفارشات');
    XLSX.writeFile(book, `سفارشات-${new Date().toLocaleDateString('fa-IR').replace(/\//g, '-')}.xlsx`);
    toast.success(`${fa(rows.length)} سفارش در فایل اکسل`);
  };

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

  const allOnPage = pageRows.length > 0 && pageRows.every((o) => selected.has(o.id));

  return (
    <div ref={rootRef} className="space-y-4">
      <PageHeader
        title="سفارش‌ها و فروش"
        description={
          <>
            {fa(orders.length)} سفارش ·{' '}
            <span className="font-mono text-[11px]">J K</span> حرکت، <span className="font-mono text-[11px]">↵</span> جزئیات،{' '}
            <span className="font-mono text-[11px]">X</span> انتخاب
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              خروجی اکسل
            </Button>
            {canManage && (
              <Button asChild>
                <Link href="/dashboard/sales/pos">
                  <Plus className="h-4 w-4" />
                  سفارش جدید
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="فروش این نما" icon={Wallet} value={fa(revenue)} unit="تومان" note="بدون لغوشده‌ها" />
        <KpiCard label="سفارش‌ها" value={fa(filtered.length)} note={`از ${fa(orders.length)}`} />
        <KpiCard
          label="مانده دریافت"
          value={fa(outstanding.reduce((sum, o) => sum + remainingOf(o), 0))}
          unit="تومان"
          note={`${fa(outstanding.length)} سفارش`}
        />
        <KpiCard label="میانگین سفارش" value={fa(live.length ? revenue / live.length : 0)} unit="تومان" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setView(v.id);
              setSelected(new Set());
            }}
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
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="شماره سفارش یا مشتری" className="ps-8" />
        </div>
        <Button variant={showFilters || hasActiveFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" />
          فیلتر
        </Button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <JalaliDatePicker name="filterFrom" label="از تاریخ" onChange={setFilterFromDate} defaultValue={filterFromDate} placeholder="شروع" />
          <JalaliDatePicker name="filterTo" label="تا تاریخ" onChange={setFilterToDate} defaultValue={filterToDate} placeholder="پایان" />
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">حداقل مبلغ (تومان)</Label>
            <Input type="number" value={filterMinAmount} onChange={(e) => setFilterMinAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">حداکثر مبلغ (تومان)</Label>
            <Input type="number" value={filterMaxAmount} onChange={(e) => setFilterMaxAmount(e.target.value)} />
          </div>
          {warehouses.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">انبار</Label>
              <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه انبارها</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {hasActiveFilters && (
            <div className="flex items-end">
              <Button variant="ghost" onClick={resetFilters}>
                <X className="h-4 w-4" />
                پاک کردن فیلترها
              </Button>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2">
          <span className="inline-flex items-center gap-1 text-[13px] text-brand">
            <Check className="h-4 w-4" />
            {fa(selected.size)} سفارش ·{' '}
            {fa(orders.filter((o) => selected.has(o.id) && o.status !== 'CANCELLED').reduce((sum, o) => sum + finalOf(o), 0))} تومان
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            اکسل انتخاب‌شده‌ها
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} title="Esc">
            <X className="h-4 w-4" />
            لغو انتخاب
          </Button>
        </div>
      )}

      <div className={cn('grid gap-4', peek && 'lg:grid-cols-[1fr_340px]')}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <th className="h-9 w-10 bg-secondary px-3">
                    <input
                      type="checkbox"
                      aria-label="انتخاب همه"
                      checked={allOnPage}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          pageRows.forEach((o) => (allOnPage ? next.delete(o.id) : next.add(o.id)));
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[#353DB2]"
                    />
                  </th>
                  <SortHead k="number">سفارش</SortHead>
                  <SortHead k="createdAt">تاریخ</SortHead>
                  <SortHead k="customer">مشتری</SortHead>
                  {!peek && <th className="hidden h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground xl:table-cell">اقلام</th>}
                  {!peek && <th className="hidden h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground xl:table-cell">کانال</th>}
                  <SortHead k="final" end>مبلغ (تومان)</SortHead>
                  {!peek && <SortHead k="remaining" end>مانده</SortHead>}
                  <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="h-24 text-center text-[13px] text-muted-foreground">
                      سفارشی با این نما و فیلترها پیدا نشد.{' '}
                      {(hasActiveFilters || query || view !== 'all') && (
                        <button
                          className="text-brand hover:underline"
                          onClick={() => {
                            resetFilters();
                            setQuery('');
                            setView('all');
                          }}
                        >
                          نمایش همه
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {pageRows.map((order, index) => {
                  const status = statusOf(order);
                  const remaining = remainingOf(order);
                  return (
                    <tr
                      key={order.id}
                      onClick={() => {
                        setCursor(index);
                        setPeekId(order.id);
                      }}
                      className={cn(
                        'h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]',
                        selected.has(order.id) && 'bg-brand-soft/60',
                        peekId === order.id && 'bg-brand-soft',
                        index === cursor && 'shadow-[inset_-2px_0_0_#353DB2]',
                      )}
                    >
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`انتخاب سفارش ${order.number}`}
                          checked={selected.has(order.id)}
                          onChange={() => toggle(order.id)}
                          className="h-4 w-4 accent-[#353DB2]"
                        />
                      </td>
                      <td className="px-3 font-mono font-bold">#{order.number}</td>
                      <td className="whitespace-nowrap px-3 font-mono text-[12px] text-muted-foreground">
                        {formatJalaliDate(order.createdAt, 'jMM/jDD HH:mm')}
                      </td>
                      <td className="max-w-[180px] truncate px-3">{order.customer?.name || 'مشتری عمومی'}</td>
                      {!peek && (
                        <td className="hidden px-3 text-[12.5px] text-muted-foreground xl:table-cell">
                          {fa(unitsOf(order))} قلم
                          {order.items[0]?.product?.sku && (
                            <>
                              {' · '}
                              <span className="font-mono">{order.items[0].product.sku}</span>
                            </>
                          )}
                        </td>
                      )}
                      {!peek && (
                        <td className="hidden px-3 xl:table-cell">
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                            {order.siteReference ? 'سایت' : order.wooId ? 'ووکامرس' : 'فروشگاه'}
                          </span>
                        </td>
                      )}
                      <td className="px-3 text-end font-medium tabular-nums">{fa(finalOf(order))}</td>
                      {!peek && (
                        <td className="px-3 text-end tabular-nums text-muted-foreground">
                          {order.status !== 'CANCELLED' && remaining > 0 ? fa(remaining) : '—'}
                        </td>
                      )}
                      <td className="px-3">
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-muted-foreground">
              <span>
                {fa(page * PAGE_SIZE + 1)} تا {fa(Math.min(filtered.length, (page + 1) * PAGE_SIZE))} از {fa(filtered.length)}
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

        {peek && (
          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 lg:sticky lg:top-20">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[15px] font-bold">#{peek.number}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {peek.customer?.name || 'مشتری عمومی'} · {formatJalaliDateTime(peek.createdAt)}
                </p>
              </div>
              <button onClick={() => setPeekId(null)} className="rounded p-1 text-muted-foreground hover:bg-secondary" title="Esc">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className={cn('rounded-full px-2 py-0.5 text-[11.5px]', statusOf(peek).tone)}>{statusOf(peek).label}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                {peek.siteReference ? 'سایت' : 'فروشگاه'}
              </span>
              {(peek.tags ?? []).map((tag) => (
                <span key={tag} className="rounded-full border px-2 py-0.5 text-[11.5px]">
                  {tag}
                </span>
              ))}
            </div>
            <div className="divide-y rounded-md border">
              {peek.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-mono" dir="ltr" style={{ textAlign: 'start' }}>
                    {item.product?.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {fa(item.quantity)} × {fa(Number(item.price))}
                  </span>
                </div>
              ))}
            </div>
            <dl className="space-y-1 text-[12.5px]">
              {Number(peek.discount || 0) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">تخفیف</dt>
                  <dd className="tabular-nums">{fa(Number(peek.discount))}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">مبلغ نهایی</dt>
                <dd className="font-medium tabular-nums">{fa(finalOf(peek))} تومان</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">پرداخت‌شده</dt>
                <dd className="tabular-nums">{fa(Number(peek.paidAmount || 0))}</dd>
              </div>
              {peek.status !== 'CANCELLED' && remainingOf(peek) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">مانده</dt>
                  <dd className="font-medium tabular-nums">{fa(remainingOf(peek))}</dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/dashboard/sales/history/${peek.id}`}>جزئیات کامل</Link>
              </Button>
              {canManage && peek.status !== 'CANCELLED' && peek.paymentStatus !== 'PAID' && (
                <Button variant="outline" size="sm" onClick={() => setPaying(peek)}>
                  <Wallet className="h-4 w-4" />
                  ثبت پرداخت
                </Button>
              )}
              {/* A website order is cancelled only on the website. */}
              {canManage && peek.status !== 'CANCELLED' && !peek.siteReference && (
                <Button variant="destructive" size="sm" onClick={() => handleCancelOrder(peek)}>
                  <XCircle className="h-4 w-4" />
                  لغو سفارش
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>

      {paying && (
        <PaymentDialog order={paying} open={!!paying} onOpenChange={(open) => !open && setPaying(null)} />
      )}
    </div>
  );
}
