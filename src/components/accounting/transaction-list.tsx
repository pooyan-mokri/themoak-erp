'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpRight,
  FileSpreadsheet,
  Paperclip,
  Plus,
  Printer,
  Scale,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { TransactionReceipt } from '@/components/accounting/transaction-receipt';
import { mayAttachReceipt } from '@/lib/receipt-ref';
import { can } from '@/lib/permissions';
import { accountLabel } from '@/lib/account-label';
import { formatJalaliDate, formatJalaliDateTime, getJalaliDayName, getStartOfJalaliYear } from '@/lib/date-utils';
import {
  exportJournalToExcel,
  printJournal,
  journalTotals,
  typeLabel,
  type JournalRow,
} from '@/lib/journal-export';
import { cn } from '@/lib/utils';
import { currencyName } from './amount-words';
import { directionOf } from './money-direction';

interface JournalRange {
  from?: string;
  to?: string;
  all: boolean;
}

type AccountOption = { id: string; name: string; currency: string; cardNumber?: string | null };

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const money = (n: number, currency: string) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: currency === 'TOMAN' ? 0 : 2 }).format(n);

const KINDS: Record<string, { icon: LucideIcon; incoming?: boolean }> = {
  INCOME: { icon: ArrowDownLeft, incoming: true },
  EXPENSE: { icon: ArrowUpRight },
  TRANSFER: { icon: ArrowLeftRight },
  ADJUSTMENT: { icon: Scale },
};

function KindIcon({ type }: { type: string }) {
  const kind = KINDS[type] ?? KINDS.ADJUSTMENT;
  return (
    <span
      className={cn(
        'inline-grid h-7 w-7 shrink-0 place-items-center rounded-md',
        kind.incoming ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground',
      )}
    >
      <kind.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  );
}

const accountNameOf = (t: any) => t.account?.name ?? (t.employee ? `حساب شخصی: ${t.employee.name}` : '-');

/**
 * Money that left a real account (or an employee's pocket) with no document on
 * it yet. EXPENSE-type accounts (COGS, commission) are bookkeeping buckets, not money.
 */
const missesReceipt = (t: any) => t.type === 'EXPENSE' && !t.receiptUrl && t.account?.type !== 'EXPENSE';

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  { id: 'INCOME', label: 'درآمد', match: (t: any) => t.type === 'INCOME' },
  { id: 'EXPENSE', label: 'هزینه', match: (t: any) => t.type === 'EXPENSE' },
  { id: 'TRANSFER', label: 'انتقال', match: (t: any) => t.type === 'TRANSFER' },
  { id: 'ADJUSTMENT', label: 'تعدیل', match: (t: any) => t.type === 'ADJUSTMENT' },
  { id: 'noReceipt', label: 'بدون پیوست', match: missesReceipt },
] as const;

type SortKey = 'date' | 'description' | 'amount' | 'account' | 'category';
const PAGE_SIZE = 50;

export function TransactionList({
  transactions,
  role,
  range,
  truncated,
  maxRows,
  accounts,
  accountId,
}: {
  transactions: any[];
  role: string | null;
  range: JournalRange;
  truncated: boolean;
  maxRows: number;
  /** For the account filter; the journal of one account opens with ?account=<id>. */
  accounts: AccountOption[];
  accountId?: string;
}) {
  const router = useRouter();
  const [loading, startNavigation] = useTransition();
  // Period filter — a journal is normally taken for a date range. The server
  // reads the period out of the address, so an older period is fetched rather
  // than filtered out of what happened to be loaded.
  const [fromDate, setFromDate] = useState<Date | undefined>(range.from ? new Date(range.from) : undefined);
  const [toDate, setToDate] = useState<Date | undefined>(range.to ? new Date(range.to) : undefined);
  const [account, setAccount] = useState<string>(accountId ?? 'all');
  // Back and forward between two accounts' journals keep this component: follow the address.
  useEffect(() => setAccount(accountId ?? 'all'), [accountId]);
  // Filtering by account needs no new read; the address only records it, so a reload keeps it.
  const chooseAccount = (id: string) => {
    setAccount(id);
    const params = new URLSearchParams(window.location.search);
    if (id === 'all') params.delete('account');
    else params.set('account', id);
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  };

  const iso = (date: Date | undefined) => (date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : undefined);
  const askFor = (next: { from?: Date; to?: Date; all?: boolean }) => {
    const params = new URLSearchParams();
    if (next.all) params.set('all', '1');
    else {
      const start = iso(next.from);
      const end = iso(next.to);
      if (start) params.set('from', start);
      if (end) params.set('to', end);
    }
    // The account being looked at stays when the period changes.
    if (account !== 'all') params.set('account', account);
    startNavigation(() => router.push(`/dashboard/accounting/transactions${params.size ? `?${params}` : ''}`));
  };

  const chooseFrom = (date: Date | undefined) => {
    setFromDate(date);
    askFor({ from: date, to: toDate });
  };
  const chooseTo = (date: Date | undefined) => {
    setToDate(date);
    askFor({ from: fromDate, to: date });
  };

  // Quick view, search, sort, page, keyboard cursor and the side panel
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [peekId, setPeekId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (fromDate) {
        const from = new Date(fromDate); from.setHours(0, 0, 0, 0);
        if (new Date(t.date) < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate); to.setHours(23, 59, 59, 999);
        if (new Date(t.date) > to) return false;
      }
      return true;
    });
  }, [transactions, fromDate, toDate]);

  const inAccount = useMemo(
    () => (account === 'all' ? filtered : filtered.filter((t) => t.accountId === account)),
    [filtered, account],
  );

  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = inAccount.filter((t) => {
      if (!currentView.match(t)) return false;
      if (!q) return true;
      return [t.description, accountNameOf(t), t.category, t.payee, ...(t.tags ?? [])]
        .some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
    });
    const value = (t: any): number | string =>
      sort.key === 'date' ? new Date(t.date).getTime()
      : sort.key === 'amount' ? (t.amountInToman ?? -Infinity)
      : sort.key === 'account' ? accountNameOf(t)
      : sort.key === 'description' ? t.description ?? ''
      : t.category ?? '';
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * dir);
  }, [inAccount, currentView, query, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageRows = shown.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage(0);
    setCursor(0);
  }, [view, query, sort, account, fromDate, toDate]);

  // Rows grouped by day while they are in date order; a day's count covers all its pages.
  const grouped = sort.key === 'date';
  const dayOf = (t: any) => formatJalaliDate(t.date);
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (grouped) for (const t of shown) counts.set(dayOf(t), (counts.get(dayOf(t)) ?? 0) + 1);
    return counts;
  }, [shown, grouped]);

  const accountName = account === 'all' ? null : accounts.find((a) => a.id === account)?.name ?? 'حساب انتخاب‌شده';

  const toRows = (rows: any[]): JournalRow[] =>
    rows.map((t) => ({
      date: t.date,
      description: t.description,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      amountInToman: t.amountInToman,
      accountName: accountNameOf(t),
      category: t.category,
    }));

  const totals = useMemo(() => journalTotals(toRows(shown)), [shown]);
  const withheld = shown.filter((t) => t.amountInToman == null).length;
  const expenses = shown.filter((t) => t.type === 'EXPENSE' && t.account?.type !== 'EXPENSE');
  const missing = shown.filter(missesReceipt).length;
  const peek = peekId ? shown.find((t) => t.id === peekId) ?? transactions.find((t) => t.id === peekId) ?? null : null;

  // Excel and print carry what the view shows.
  const handleExcel = () => {
    if (shown.length === 0) { toast.error('سندی برای خروجی وجود ندارد.'); return; }
    exportJournalToExcel(toRows(shown), fromDate, toDate);
    toast.success('فایل اکسل دانلود شد.');
  };

  const handlePrint = () => {
    if (shown.length === 0) { toast.error('سندی برای خروجی وجود ندارد.'); return; }
    const ok = printJournal(toRows(shown), fromDate, toDate);
    if (!ok) toast.error('مرورگر پنجره چاپ را مسدود کرد. لطفا اجازه باز شدن پنجره را بدهید.');
  };

  const resetFilters = () => {
    setView('all');
    setQuery('');
    chooseAccount('all');
  };

  // J/K move, Enter opens the side panel, Esc closes it — not while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (target?.closest('[role="dialog"], [role="listbox"]')) return;
      const row = pageRows[cursor];
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(pageRows.length - 1, cursor + 1);
        setCursor(next);
        if (peekId && pageRows[next]) setPeekId(pageRows[next].id);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, cursor - 1);
        setCursor(next);
        if (peekId && pageRows[next]) setPeekId(pageRows[next].id);
      } else if (event.key === 'Enter' && row) {
        event.preventDefault();
        setPeekId((id) => (id === row.id ? null : row.id));
      } else if (event.key === 'Escape') {
        setPeekId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageRows, cursor, peekId]);

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

  const amountCell = (t: any) => {
    // A COGS or gift amount, withheld from a role without cost.view.
    if (t.amount == null) return <span className="text-muted-foreground">—</span>;
    const sign = directionOf(t) > 0 ? '+' : '−';
    return (
      <div className="flex flex-col items-end">
        <span className="tabular-nums">
          {/* The sign stays before the figure, as the number format writes a negative. */}
          <span dir="ltr">
            {sign}
            {money(Math.abs(Number(t.amount)), t.currency)}
          </span>
          {t.currency !== 'TOMAN' && <span className="ms-1 text-[11px] text-muted-foreground">{currencyName(t.currency)}</span>}
        </span>
        {t.currency !== 'TOMAN' && t.amountInToman != null && (
          <span className="text-[11.5px] tabular-nums text-muted-foreground">({fa(Math.abs(Number(t.amountInToman)))} تومان)</span>
        )}
      </div>
    );
  };

  const period =
    range.all ? 'همهٔ تاریخچه'
    : fromDate && toDate ? `از ${formatJalaliDate(fromDate)} تا ${formatJalaliDate(toDate)}`
    : fromDate ? `از ${formatJalaliDate(fromDate)} تا امروز`
    : toDate ? `تا ${formatJalaliDate(toDate)}`
    : 'همهٔ تاریخچه';

  return (
    <div className="space-y-4">
      <PageHeader
        title="دفتر روزنامه"
        description={
          <>
            {period} · {fa(filtered.length)} سند ·{' '}
            <span className="font-mono text-[11px]">J K</span> حرکت، <span className="font-mono text-[11px]">↵</span> جزئیات،{' '}
            <span className="font-mono text-[11px]">Esc</span> بستن
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={handleExcel}>
              <FileSpreadsheet className="h-4 w-4" />
              اکسل
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              PDF / چاپ
            </Button>
            {can(role, 'finance.manage') && (
              <Button asChild>
                <Link href="/dashboard/accounting/expenses/new">
                  <Plus className="h-4 w-4" />
                  تراکنش جدید
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* The period, read from the address */}
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-44">
            <JalaliDatePicker
              name="journalFrom"
              label="از تاریخ"
              key={`from-${range.from ?? 'none'}`}
              defaultValue={fromDate}
              onChange={chooseFrom}
              placeholder="ابتدای دوره"
            />
          </div>
          <div className="w-full sm:w-44">
            <JalaliDatePicker
              name="journalTo"
              label="تا تاریخ"
              key={`to-${range.to ?? 'none'}`}
              defaultValue={toDate}
              onChange={chooseTo}
              placeholder="انتهای دوره"
            />
          </div>
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFromDate(undefined);
                setToDate(undefined);
                askFor({});
              }}
            >
              <X className="h-4 w-4" />
              حذف بازه
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] sm:ms-auto">
            <span className="text-muted-foreground">دورهٔ آماده:</span>
            <Button variant="outline" size="sm" onClick={() => { setFromDate(undefined); setToDate(undefined); askFor({}); }}>
              ۳ ماه اخیر
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const start = getStartOfJalaliYear();
                setFromDate(start);
                setToDate(undefined);
                askFor({ from: start });
              }}
            >
              از ابتدای امسال
            </Button>
            <Button
              variant={range.all ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setFromDate(undefined); setToDate(undefined); askFor({ all: true }); }}
            >
              همهٔ تاریخچه
            </Button>
            {loading && <span className="text-muted-foreground">در حال خواندن…</span>}
          </div>
        </div>
        {truncated && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
            فقط {maxRows.toLocaleString('fa-IR')} سند آخر این بازه خوانده شد؛ برای دیدن قدیمی‌ترها بازه را کوچک‌تر کنید.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="تعداد اسناد" value={fa(shown.length)} note={shown.length === filtered.length ? 'همهٔ این دوره' : `از ${fa(filtered.length)} سند دوره`} />
        <KpiCard label="جمع درآمد" value={fa(Math.round(totals.income))} unit="تومان" note={withheld ? 'بدون مبالغ پنهان' : undefined} />
        <KpiCard label="جمع هزینه" value={fa(Math.round(totals.expense))} unit="تومان" note={withheld ? 'بدون مبالغ پنهان' : undefined} />
        <KpiCard label="خالص" value={fa(Math.round(totals.net))} unit="تومان" note="درآمد منهای هزینه" />
        <button
          type="button"
          onClick={() => setView(view === 'noReceipt' ? 'all' : 'noReceipt')}
          className={cn('rounded-lg text-start transition-colors duration-150 [&>div]:hover:border-brand', view === 'noReceipt' && '[&>div]:border-brand')}
          title="نمایش هزینه‌های بدون پیوست"
        >
          <KpiCard
            label="هزینه بدون پیوست"
            icon={Paperclip}
            value={fa(missing)}
            note={`از ${fa(expenses.length)} هزینهٔ این نما`}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
              view === v.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
            )}
          >
            {v.label}
            <span className="font-mono text-[11px] opacity-70">{fa(inAccount.filter(v.match).length)}</span>
          </button>
        ))}
        <div className="flex-1" />
        <Select value={account} onValueChange={chooseAccount}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="همهٔ حساب‌ها" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همهٔ حساب‌ها</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {accountLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="شرح، حساب، دسته‌بندی، گیرنده" className="ps-8" />
        </div>
      </div>

      {accountName && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-[13px] text-brand">
          دفتر حساب «{accountName}» · {fa(inAccount.length)} سند در این دوره
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => chooseAccount('all')}>
            <X className="h-4 w-4" />
            همهٔ حساب‌ها
          </Button>
        </div>
      )}

      <div className={cn('grid gap-4', peek && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <SortHead k="date">تاریخ</SortHead>
                  <SortHead k="description">شرح</SortHead>
                  <SortHead k="account">حساب</SortHead>
                  <SortHead k="category">دسته‌بندی</SortHead>
                  <SortHead k="amount" end>مبلغ</SortHead>
                  <th className="h-9 bg-secondary px-3 text-center text-xs font-normal text-muted-foreground">پیوست</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="h-24 px-3 text-center text-[13px] text-muted-foreground">
                      {filtered.length === 0
                        ? 'در این دوره سندی ثبت نشده است. دورهٔ دیگری را انتخاب کنید یا «همهٔ تاریخچه» را ببینید.'
                        : 'سندی با این نما و فیلترها پیدا نشد.'}{' '}
                      {filtered.length > 0 && (view !== 'all' || query || account !== 'all') && (
                        <button className="text-brand hover:underline" onClick={resetFilters}>
                          نمایش همه
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {pageRows.map((t, index) => {
                  const day = dayOf(t);
                  const opensDay = grouped && (index === 0 || dayOf(pageRows[index - 1]) !== day);
                  return (
                    <Fragment key={t.id}>
                      {opensDay && (
                        <tr className="border-b bg-secondary/50">
                          <td colSpan={6} className="h-8 px-3 text-[11.5px] font-medium text-muted-foreground">
                            {day} · {getJalaliDayName(t.date)}
                            <span className="ms-2 font-normal">{fa(dayCounts.get(day) ?? 0)} سند</span>
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => {
                          setCursor(index);
                          setPeekId(t.id);
                        }}
                        className={cn(
                          'h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]',
                          peekId === t.id && 'bg-brand-soft',
                          index === cursor && 'shadow-[inset_-2px_0_0_#353DB2]',
                        )}
                      >
                        <td className="px-3">
                          <div className="flex items-center gap-2">
                            <KindIcon type={t.type} />
                            {!grouped && (
                              <span className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">{formatJalaliDate(t.date, 'jYY/jMM/jDD')}</span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[320px] px-3 py-1.5">
                          <div className="truncate">{t.description || '-'}</div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {typeLabel(t.type)}
                            {t.payee && <> · {t.payee}</>}
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate px-3 text-[13px]">{accountNameOf(t)}</td>
                        <td className="max-w-[160px] truncate px-3 text-[12.5px] text-muted-foreground">{t.category || '-'}</td>
                        <td className="whitespace-nowrap px-3 text-end">{amountCell(t)}</td>
                        <td className="px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <TransactionReceipt
                            transactionId={t.id}
                            receiptUrl={t.receiptUrl}
                            canAttach={mayAttachReceipt(role, t)}
                            canReplace={role === 'ADMIN'}
                          />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-muted-foreground">
              <span>
                {fa(page * PAGE_SIZE + 1)} تا {fa(Math.min(shown.length, (page + 1) * PAGE_SIZE))} از {fa(shown.length)}
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
              <div className="flex min-w-0 items-start gap-2.5">
                <KindIcon type={peek.type} />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{peek.description || '-'}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {typeLabel(peek.type)} · {formatJalaliDate(peek.date)} {getJalaliDayName(peek.date)}
                  </p>
                </div>
              </div>
              <button onClick={() => setPeekId(null)} className="rounded p-1 text-muted-foreground hover:bg-secondary" title="Esc">
                <X className="h-4 w-4" />
              </button>
            </div>

            {peek.amount == null ? (
              <p className="text-[13px] text-muted-foreground">مبلغ این سند بهای تمام‌شده است و برای نقش شما نمایش داده نمی‌شود.</p>
            ) : (
              <div>
                <div className="text-[22px] font-medium tabular-nums">
                  <span dir="ltr">
                    {directionOf(peek) > 0 ? '+' : '−'}
                    {money(Math.abs(Number(peek.amount)), peek.currency)}
                  </span>
                  <small className="ms-1 text-[12px] font-normal text-muted-foreground">{currencyName(peek.currency)}</small>
                </div>
                {peek.currency !== 'TOMAN' && peek.amountInToman != null && (
                  <p className="text-[12px] tabular-nums text-muted-foreground">
                    معادل {fa(Math.abs(Number(peek.amountInToman)))} تومان · نرخ {fa(Number(peek.rateSnapshot))}
                  </p>
                )}
              </div>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
              <dt className="text-muted-foreground">حساب</dt>
              <dd className="min-w-0">
                {peek.accountId ? (
                  <button
                    type="button"
                    className="text-start text-brand hover:underline"
                    onClick={() => chooseAccount(peek.accountId)}
                    title="دفتر این حساب"
                  >
                    {accountNameOf(peek)}
                  </button>
                ) : (
                  accountNameOf(peek)
                )}
              </dd>
              <dt className="text-muted-foreground">دسته‌بندی</dt>
              <dd>{peek.category || '-'}</dd>
              {peek.payee && (
                <>
                  <dt className="text-muted-foreground">گیرنده</dt>
                  <dd>{peek.payee}</dd>
                </>
              )}
              {peek.tags?.length > 0 && (
                <>
                  <dt className="text-muted-foreground">برچسب‌ها</dt>
                  <dd className="flex flex-wrap gap-1">
                    {peek.tags.map((tag: string) => (
                      <span key={tag} className="rounded-full border px-2 py-0.5 text-[11.5px]">{tag}</span>
                    ))}
                  </dd>
                </>
              )}
              {peek.orderId && can(role, 'sales.view') && (
                <>
                  <dt className="text-muted-foreground">سفارش</dt>
                  <dd>
                    <Link href={`/dashboard/sales/history/${peek.orderId}`} className="text-brand hover:underline">
                      جزئیات سفارش
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">زمان ثبت</dt>
              <dd className="tabular-nums">{formatJalaliDateTime(peek.createdAt)}</dd>
            </dl>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="text-muted-foreground">سند پیوست</span>
                {peek.receiptUrl ? (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">دارد</span>
                ) : missesReceipt(peek) ? (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">پیوست ندارد</span>
                ) : (
                  <span className="text-muted-foreground">ندارد</span>
                )}
              </div>
              <TransactionReceipt
                transactionId={peek.id}
                receiptUrl={peek.receiptUrl}
                canAttach={mayAttachReceipt(role, peek)}
                canReplace={role === 'ADMIN'}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
