'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, BookOpen, Coins, Landmark, Pencil, Plus, Settings2, Trash2, User, Wallet, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { SectionCard } from '@/components/dashboard/section-card';
import { deleteAccount } from '@/actions/accounting';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { AccountForm } from './account-form';
import { Sparkline } from './sparkline';
import { currencyName } from './amount-words';
import { ACCOUNT_TYPE_LABELS } from '@/lib/account-label';

export type AccountMovement = {
  id: string;
  date: Date | string;
  description?: string | null;
  category?: string | null;
  /** In the account's currency; null when withheld from this role (a cost row). */
  amount: number | null;
  direction: 1 | -1;
};

export type AccountRow = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  cardNumber?: string | null;
  sheba?: string | null;
  createdAt: Date | string;
  /** The balance at the end of each of the last 8 weeks, then now; null when it cannot be rebuilt. */
  history: number[] | null;
  /** Why there is no history, when there is none. */
  historyGap: string | null;
  /** Journal rows of the last 8 weeks, newest first. */
  movements: AccountMovement[];
};

interface AccountListProps {
  accounts: AccountRow[];
  /** May create, edit and delete accounts (finance.manage). */
  canManage: boolean;
}

// The type names are the ones every screen uses (src/lib/account-label.ts); the icon is this list's own.
const ICONS: Record<string, LucideIcon> = { BANK: Landmark, CASH: Wallet, PERSON: User, CRYPTO: Coins, EXPENSE: Settings2 };
const TYPES: Record<string, { label: string; icon: LucideIcon }> = Object.fromEntries(
  Object.entries(ICONS).map(([type, icon]) => [type, { label: ACCOUNT_TYPE_LABELS[type] ?? type, icon }]),
);
const typeOf = (type: string) => TYPES[type] ?? { label: ACCOUNT_TYPE_LABELS[type] ?? type, icon: Wallet };

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
/** A balance in the account's own currency: whole Toman, cents for a foreign one. */
const money = (n: number, currency: string) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: currency === 'TOMAN' ? 0 : 2 }).format(n);
const cardDigits = (card?: string | null) => (card ?? '').replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

// EXPENSE accounts (COGS, commission, …) are system P&L buckets too: the
// form can't represent their type, and the code finds them by name.
const isSystemAccount = (account: AccountRow) => account.name === 'Marketing Expenses' || account.type === 'EXPENSE';

export function AccountList({ accounts, canManage }: AccountListProps) {
  const [type, setType] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (accounts.find((a) => a.type === 'BANK' || a.type === 'CASH') ?? accounts[0])?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const chips = useMemo(
    () => [
      { id: 'all', label: 'همه', count: accounts.length },
      ...Object.entries(TYPES)
        .map(([id, t]) => ({ id, label: t.label, count: accounts.filter((a) => a.type === id).length }))
        .filter((chip) => chip.count > 0),
    ],
    [accounts],
  );
  const shown = type === 'all' ? accounts : accounts.filter((a) => a.type === type);
  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  // The money the company holds, per currency: never Toman and dollars in one sum.
  const held = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of accounts) {
      if (a.type !== 'BANK' && a.type !== 'CASH') continue;
      totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
    }
    return Array.from(totals.entries()).sort(([a], [b]) => (a === 'TOMAN' ? -1 : b === 'TOMAN' ? 1 : a.localeCompare(b)));
  }, [accounts]);

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    const result = await deleteAccount(deleting.id);
    setIsDeleting(false);
    if (result.success) {
      toast.success(result.message);
      if (selectedId === deleting.id) setSelectedId(null);
      setDeleting(null);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="مدیریت حساب‌ها"
        description={
          held.length > 0
            ? `${fa(accounts.length)} حساب · موجودی بانک و صندوق: ${held.map(([c, sum]) => `${money(sum, c)} ${currencyName(c)}`).join(' + ')}`
            : `${fa(accounts.length)} حساب`
        }
        actions={
          canManage && (
            <>
              <Button variant="outline" asChild>
                <Link href="/dashboard/accounting/transfers/new">
                  <ArrowLeftRight className="h-4 w-4" />
                  انتقال داخلی
                </Link>
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                حساب جدید
              </Button>
            </>
          )
        }
      />

      {accounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={type === chip.id}
              onClick={() => setType(chip.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
                type === chip.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
              )}
            >
              {chip.label}
              <span className="font-mono text-[11px] opacity-70">{fa(chip.count)}</span>
            </button>
          ))}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-[13px] text-muted-foreground">
          هنوز حسابی تعریف نشده است.{' '}
          {canManage ? 'با «حساب جدید» اولین بانک یا صندوق را بسازید؛ ثبت هزینه و واریز به آن نیاز دارد.' : 'تعریف حساب با مدیر مالی است.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((account) => {
            const t = typeOf(account.type);
            return (
              <button
                key={account.id}
                type="button"
                aria-pressed={account.id === selectedId}
                onClick={() => setSelectedId(account.id)}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border bg-card p-4 text-start transition-colors duration-150 hover:border-foreground/30',
                  account.id === selectedId && 'border-brand ring-[3px] ring-brand-soft hover:border-brand',
                )}
              >
                <span className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <t.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t.label}
                  </span>
                  {account.history && <Sparkline points={account.history} label="روند موجودی ۸ هفته" />}
                </span>
                <span className="truncate text-[13.5px] font-medium">{account.name}</span>
                <span className="h-4 truncate font-mono text-[11px] text-muted-foreground" dir="ltr" style={{ textAlign: 'end' }}>
                  {cardDigits(account.cardNumber) || account.sheba || ''}
                </span>
                <span className="text-[19px] font-medium tabular-nums">
                  {money(account.balance, account.currency)}
                  <small className="ms-1 text-[11px] font-normal text-muted-foreground">{currencyName(account.currency)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <SectionCard
            title={`گردش ${selected.name}`}
            count={selected.movements.length ? fa(selected.movements.length) : undefined}
            aside={<span className="text-muted-foreground">۸ هفتهٔ اخیر</span>}
            link={{ href: `/dashboard/accounting/transactions?account=${selected.id}`, label: 'همه در دفتر روزنامه' }}
          >
            {selected.movements.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                در هشت هفتهٔ اخیر سندی به این حساب نخورده است. تراکنش‌های قدیمی‌تر در دفتر روزنامه هستند.
              </p>
            ) : (
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-y">
                      <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">تاریخ</th>
                      <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">شرح</th>
                      <th className="hidden h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground sm:table-cell">دسته‌بندی</th>
                      <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">
                        مبلغ ({currencyName(selected.currency)})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.movements.slice(0, 12).map((row) => (
                      <tr key={row.id} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                        <td className="whitespace-nowrap px-3 font-mono text-[12px] text-muted-foreground">{formatJalaliDate(row.date, 'jMM/jDD')}</td>
                        <td className="max-w-[260px] truncate px-3">{row.description || '—'}</td>
                        <td className="hidden px-3 text-[12.5px] text-muted-foreground sm:table-cell">{row.category || '—'}</td>
                        <td className="whitespace-nowrap px-3 text-end tabular-nums">
                          {row.amount === null ? (
                            <span className="text-muted-foreground" title="مبلغ بهای تمام‌شده برای نقش شما نمایش داده نمی‌شود">—</span>
                          ) : (
                            <span dir="ltr">
                              {row.direction > 0 ? '+' : '−'}
                              {money(Math.abs(row.amount), selected.currency)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selected.movements.length > 12 && (
                  <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">
                    {fa(selected.movements.length - 12)} سند دیگر در این هشت هفته؛ همه در دفتر روزنامه.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          <aside className="h-fit space-y-4 rounded-lg border bg-card p-4">
            <h3 className="text-sm font-medium">مشخصات حساب</h3>
            <div>
              <div className="text-[22px] font-medium tabular-nums">
                {money(selected.balance, selected.currency)}
                <small className="ms-1 text-[12px] font-normal text-muted-foreground">{currencyName(selected.currency)}</small>
              </div>
              <p className="text-[12px] text-muted-foreground">موجودی فعلی، به ارز خود حساب</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
              <dt className="text-muted-foreground">نوع</dt>
              <dd>{typeOf(selected.type).label}</dd>
              <dt className="text-muted-foreground">ارز</dt>
              <dd>{currencyName(selected.currency)}</dd>
              {selected.cardNumber && (
                <>
                  <dt className="text-muted-foreground">شماره کارت</dt>
                  <dd className="font-mono text-[12.5px]" dir="ltr" style={{ textAlign: 'end' }}>{cardDigits(selected.cardNumber)}</dd>
                </>
              )}
              {selected.sheba && (
                <>
                  <dt className="text-muted-foreground">شبا</dt>
                  <dd className="break-all font-mono text-[12px]" dir="ltr" style={{ textAlign: 'end' }}>{selected.sheba}</dd>
                </>
              )}
              <dt className="text-muted-foreground">تعریف شده</dt>
              <dd>{formatJalaliDate(selected.createdAt)}</dd>
              <dt className="text-muted-foreground">روند ۸ هفته</dt>
              <dd>
                {selected.history ? (
                  <div className="space-y-1">
                    <Sparkline points={selected.history} width={160} height={32} label="روند موجودی ۸ هفته" />
                    <p className="text-[11.5px] tabular-nums text-muted-foreground">
                      از {money(selected.history[0], selected.currency)} به {money(selected.balance, selected.currency)}
                    </p>
                  </div>
                ) : (
                  <span className="text-[12px] text-muted-foreground">{selected.historyGap ?? '—'}</span>
                )}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/accounting/transactions?account=${selected.id}`}>
                  <BookOpen className="h-4 w-4" />
                  دفتر این حساب
                </Link>
              </Button>
              {canManage && !isSystemAccount(selected) && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(selected)}>
                    <Pencil className="h-4 w-4" />
                    ویرایش
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleting(selected)}>
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                </>
              )}
            </div>
            {canManage && isSystemAccount(selected) && (
              <p className="text-[12px] text-muted-foreground">حساب سیستمی است و ویرایش یا حذف نمی‌شود.</p>
            )}
          </aside>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعریف حساب جدید</DialogTitle>
          </DialogHeader>
          <AccountForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ویرایش حساب</DialogTitle>
          </DialogHeader>
          {editing && <AccountForm initialData={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حساب «{deleting?.name}» حذف شود؟</AlertDialogTitle>
            <AlertDialogDescription>
              این عملیات قابل بازگشت نیست. در صورت وجود تراکنش، امکان حذف وجود ندارد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? 'در حال حذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
