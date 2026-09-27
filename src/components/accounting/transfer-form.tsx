'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordInternalTransfer } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { TagInput } from '@/components/ui/tag-input';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';
import { accountLabel } from '@/lib/account-label';
import { ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { currencyName } from './amount-words';
import { SectionCard } from '@/components/dashboard/section-card';
import { AmountField, RecentEntries, SubmitShortcut, type RecentEntry } from './entry-parts';

const initialState = { message: '', errors: {}, success: false };

interface Account {
  id: string;
  name: string;
  currency: string;
  balance: number;
  cardNumber?: string | null;
}

/** A recent transfer; picking it fills the form with its two accounts and amount. */
export type RecentTransfer = RecentEntry & {
  fill: { fromAccountId: string; toAccountId: string };
};

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: currency === 'TOMAN' ? 0 : 2 }).format(n);

/** One side of the transfer: its balance now and after. */
function EndBalance({ account, delta }: { account?: Account; delta: number }) {
  if (!account) return <p className="text-[12px] text-muted-foreground">موجودی پس از انتخاب حساب دیده می‌شود.</p>;
  const after = account.balance + delta;
  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">اکنون</span>
        <span className="tabular-nums">{money(account.balance, account.currency)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 border-t pt-1.5 font-medium">
        <span>پس از انتقال</span>
        <span className="tabular-nums">
          {money(after, account.currency)} <small className="text-[11px] font-normal text-muted-foreground">{currencyName(account.currency)}</small>
        </span>
      </div>
      {after < 0 && (
        <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] text-danger">موجودی کافی نیست؛ ثبت نمی‌شود</span>
      )}
    </div>
  );
}

export function TransferForm({ accounts, recent = [] }: { accounts: Account[]; recent?: RecentTransfer[] }) {
  const [state, dispatch] = useFormState(recordInternalTransfer, initialState);
  const [requestId, renewRequestId] = useRequestId();
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      setFromAccountId('');
      setToAccountId('');
      setDate(new Date());
      setReceiptUrl('');
      setReceiptType('');
      setAmount('');
      // A new id, and a fresh form (it is keyed by the id), for the next entry.
      renewRequestId();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, renewRequestId]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const currencyMismatch = fromAccount && toAccount && fromAccount.currency !== toAccount.currency;
  const moved = Number(amount) > 0 ? Number(amount) : 0;

  // Filter destination to same currency as source
  const eligibleTargets = fromAccountId
    ? accounts.filter((a) => a.id !== fromAccountId && a.currency === fromAccount?.currency)
    : accounts.filter((a) => a.id !== fromAccountId);

  // Both sides are in one currency, so the destination can become the source.
  const swap = () => {
    if (!fromAccountId || !toAccountId) return;
    setFromAccountId(toAccountId);
    setToAccountId(fromAccountId);
  };

  const repeat = (entry: RecentTransfer) => {
    setFromAccountId(entry.fill.fromAccountId);
    setToAccountId(entry.fill.toAccountId);
    setAmount(String(entry.amount));
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border bg-card">
        <form key={requestId} action={dispatch}>
          <RequestIdField value={requestId} />
          <input type="hidden" name="receiptUrl" value={receiptUrl} />
          <div className="space-y-4 p-4 sm:p-5 [&_label]:text-xs [&_label]:text-muted-foreground">
            <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)]">
              {/* From Account */}
              <div className="space-y-2.5 rounded-lg border p-3.5">
                <Label className="text-xs text-muted-foreground">از حساب *</Label>
                <Select name="fromAccountId" value={fromAccountId} onValueChange={(v) => { setFromAccountId(v); setToAccountId(''); }} required>
                  <SelectTrigger><SelectValue placeholder="از کدام حساب..." /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {accountLabel(a)} — {a.balance.toLocaleString('fa-IR')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors?.fromAccountId && <p className="text-xs text-danger">{errors.fromAccountId[0]}</p>}
                <EndBalance account={fromAccount} delta={-moved} />
              </div>

              <button
                type="button"
                onClick={swap}
                disabled={!fromAccountId || !toAccountId}
                className="mx-auto grid h-11 w-11 place-items-center rounded-full border bg-card text-brand transition-colors duration-150 hover:bg-brand-soft disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-60"
                title="جابجایی مبدأ و مقصد"
                aria-label="جابجایی مبدأ و مقصد"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>

              {/* To Account */}
              <div className="space-y-2.5 rounded-lg border p-3.5">
                <Label className="text-xs text-muted-foreground">به حساب *</Label>
                {/* Keyed by the source: its list of targets changes with it, and a fresh picker
                    takes the swapped value without Radix resetting it to an option not yet listed. */}
                <Select key={fromAccountId || 'none'} name="toAccountId" value={toAccountId} onValueChange={setToAccountId} required disabled={!fromAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder={fromAccountId ? `فقط حساب‌های ${fromAccount?.currency}` : 'ابتدا حساب مبدأ را انتخاب کنید'} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleTargets.length === 0 ? (
                      <SelectItem value="none" disabled>حساب دیگری با این ارز وجود ندارد</SelectItem>
                    ) : (
                      eligibleTargets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {accountLabel(a)} — {a.balance.toLocaleString('fa-IR')}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors?.toAccountId && <p className="text-xs text-danger">{errors.toAccountId[0]}</p>}
                <EndBalance account={toAccount} delta={moved} />
              </div>
            </div>

            {currencyMismatch && (
              <div className="flex items-center gap-2 rounded-md bg-warning-soft p-3 text-[13px] text-warning">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                ارز دو حساب یکسان نیست. برای تبدیل ارز از بخش «خرید و فروش ارز» استفاده کنید.
              </div>
            )}

            <AmountField
              label={`مبلغ${fromAccount ? ` (${currencyName(fromAccount.currency)})` : ''} *`}
              value={amount}
              onValueChange={setAmount}
              currency={fromAccount?.currency}
              step="0.01"
              min="0"
              placeholder="0"
              required
              error={errors?.amount?.[0]}
            />

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs text-muted-foreground">توضیحات</Label>
              <Textarea id="description" name="description" placeholder="شرح انتقال (اختیاری)..." rows={2} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <JalaliDatePicker name="date" label="تاریخ انتقال" defaultValue={date} onChange={(d) => d && setDate(d)} />
              <TagInput name="tags" label="تگ‌ها" placeholder="مثال: انتقال‌ماهانه..." />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">سند / رسید انتقال (اختیاری)</Label>
              <ReceiptUpload
                onUploadComplete={(url, type) => { setReceiptUrl(url); setReceiptType(type); }}
                onRemove={() => { setReceiptUrl(''); setReceiptType(''); }}
                currentUrl={receiptUrl}
                currentType={receiptType}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <span className="min-w-0 truncate text-[12px] text-muted-foreground">
              {fromAccount && toAccount ? `${fromAccount.name} ← ${toAccount.name}` : 'در سود و زیان اثری ندارد.'}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              <SubmitShortcut />
              <SubmitButton />
            </div>
          </div>
        </form>
      </div>

      <SectionCard title="انتقال‌های اخیر" aside={<span className="text-muted-foreground">برای تکرار بزنید</span>}>
        <RecentEntries entries={recent} onPick={repeat} empty="هنوز انتقالی بین حساب‌ها ثبت نشده است." />
      </SectionCard>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'در حال انتقال...' : 'ثبت انتقال'}
    </Button>
  );
}
