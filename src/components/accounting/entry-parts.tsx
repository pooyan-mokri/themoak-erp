'use client';

import { useEffect, useRef, type InputHTMLAttributes } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { amountInWords, currencyName } from './amount-words';

/**
 * Pieces shared by the money forms (expense, deposit, payment, transfer):
 * the switch between them, the amount with its words, the balance before and
 * after, recent entries to repeat, and ⌘↵ to submit. Presentation only: each
 * form keeps its own fields, action and request id.
 */

const fa = (n: number, currency?: string) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: !currency || currency === 'TOMAN' ? 0 : 2 }).format(n);

export type MoneyFormKind = 'expense' | 'deposit' | 'payment';

const MONEY_FORMS: { kind: MoneyFormKind; label: string; href: string }[] = [
  { kind: 'expense', label: 'هزینه', href: '/dashboard/accounting/expenses/new' },
  { kind: 'deposit', label: 'واریز', href: '/dashboard/accounting/deposits/new' },
  { kind: 'payment', label: 'پرداخت', href: '/dashboard/accounting/withdrawals/new' },
];

/** A segmented switch between the three money forms; each is its own page. */
export function MoneyFormSwitch({ current }: { current: MoneyFormKind }) {
  return (
    <nav aria-label="نوع سند" className="inline-flex gap-0.5 rounded-lg border bg-secondary p-[3px]">
      {MONEY_FORMS.map((form) => (
        <Link
          key={form.kind}
          href={form.href}
          aria-current={form.kind === current ? 'page' : undefined}
          className={cn(
            'inline-flex h-[30px] items-center rounded-md px-3.5 text-[13px] transition-colors duration-150',
            form.kind === current ? 'bg-card font-medium text-foreground ring-1 ring-input' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {form.label}
        </Link>
      ))}
    </nav>
  );
}

/** The big amount field, and under it the figure grouped and written out in words. */
export function AmountField({
  label = 'مبلغ',
  currency,
  error,
  value,
  onValueChange,
  ...input
}: {
  label?: string;
  /** The currency the amount is typed in; none chosen yet shows a hint. */
  currency?: string;
  error?: string;
  value: string;
  onValueChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const n = Number(value);
  // Before an account is chosen the currency is not known yet: the words go without it.
  const words = value && Number.isFinite(n) && n > 0 ? amountInWords(n, currency) : '';
  return (
    <div className="space-y-1.5">
      <Label htmlFor={input.id ?? 'amount'} className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-baseline gap-3 rounded-lg border border-input bg-card px-4 py-2.5 transition-colors duration-150 focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/[.12]">
        <input
          id="amount"
          name="amount"
          type="number"
          dir="ltr"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-end font-mono text-[26px] tabular-nums outline-none placeholder:text-muted-foreground/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          {...input}
        />
        <span className="shrink-0 text-[13px] text-muted-foreground">{currency ? currencyName(currency) : 'ارز حساب'}</span>
      </div>
      <p className="min-h-[18px] text-[12px] text-muted-foreground">
        {words ? (
          <>
            <span className="tabular-nums">{fa(n, currency)}</span> — {words}
          </>
        ) : (
          'مبلغ را به عدد وارد کنید؛ به حروف همین‌جا نوشته می‌شود.'
        )}
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type PreviewAccount = { name: string; balance: number; currency: string };

/**
 * An account's balance now and after this entry, from the balance the form
 * already loaded. Exact only when the amount is in the account's currency; a
 * converted amount is worked out on the server with the latest rate.
 */
export function BalancePreview({
  account,
  amount,
  currency,
  direction,
  caption,
}: {
  account?: PreviewAccount;
  amount: number;
  currency?: string;
  direction: 1 | -1;
  caption?: string;
}) {
  if (!account) {
    return <p className="text-[12.5px] text-muted-foreground">حساب را انتخاب کنید تا موجودی پیش و پس از ثبت دیده شود.</p>;
  }
  const same = !currency || currency === account.currency;
  const after = account.balance + direction * (Number.isFinite(amount) ? amount : 0);
  return (
    <div className="space-y-2 text-[13px]">
      {caption && <p className="text-[11.5px] text-muted-foreground">{caption}</p>}
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-muted-foreground">موجودی فعلی {account.name}</span>
        <b className="shrink-0 font-normal tabular-nums">{fa(account.balance, account.currency)}</b>
      </div>
      {same ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{direction > 0 ? 'واریز' : 'برداشت'}</span>
            <b className="font-normal tabular-nums" dir="ltr">
              {direction > 0 ? '+' : '−'}
              {fa(amount > 0 ? amount : 0, account.currency)}
            </b>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
            <span>موجودی پس از ثبت</span>
            <b className="text-[15px] tabular-nums">
              {fa(after, account.currency)} <small className="text-[11px] font-normal text-muted-foreground">{currencyName(account.currency)}</small>
            </b>
          </div>
          {direction < 0 && after < 0 && (
            <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] text-danger">موجودی کافی نیست؛ ثبت نمی‌شود</span>
          )}
        </>
      ) : (
        <p className="border-t pt-2 text-[12px] text-muted-foreground">
          مبلغ به {currencyName(currency)} است و هنگام ثبت با آخرین نرخ به {currencyName(account.currency)} تبدیل می‌شود؛ برای همین موجودی پس
          از ثبت اینجا حساب نمی‌شود.
        </p>
      )}
    </div>
  );
}

export type RecentEntry = {
  id: string;
  title: string;
  sub: string;
  amount: number;
  currency: string;
};

/** Recent entries of this kind; picking one fills the form with it. */
export function RecentEntries<T extends RecentEntry>({
  entries,
  onPick,
  empty,
}: {
  entries: T[];
  onPick: (entry: T) => void;
  empty: string;
}) {
  if (entries.length === 0) return <p className="py-2 text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-4 -mb-4 divide-y border-t">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onPick(entry)}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-start transition-colors duration-150 hover:bg-brand/[.04]"
            title="پر کردن فرم با همین"
          >
            <span className="truncate text-[13px]">{entry.title}</span>
            <span className="text-end text-[13px] tabular-nums">
              {fa(entry.amount, entry.currency)}
              {entry.currency !== 'TOMAN' && <small className="ms-1 text-[11px] text-muted-foreground">{currencyName(entry.currency)}</small>}
            </span>
            <span className="col-span-2 truncate text-[11.5px] text-muted-foreground">{entry.sub}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** ⌘↵ (Ctrl+Enter) submits the form this sits in, unless it is already sending. */
export function SubmitShortcut() {
  const { pending } = useFormStatus();
  const marker = useRef<HTMLSpanElement>(null);
  const busy = useRef(pending);
  busy.current = pending;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || busy.current) return;
      const form = marker.current?.closest('form');
      if (!form) return;
      // Only this form's keys: typing in it, or nothing focused at all.
      const active = document.activeElement;
      if (active && active !== document.body && !form.contains(active)) return;
      event.preventDefault();
      form.requestSubmit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <span ref={marker} className="hidden text-[11.5px] text-muted-foreground sm:inline">
      <kbd className="rounded border bg-card px-1 font-mono text-[10.5px]">⌘</kbd>{' '}
      <kbd className="rounded border bg-card px-1 font-mono text-[10.5px]">↵</kbd> ثبت
    </span>
  );
}
