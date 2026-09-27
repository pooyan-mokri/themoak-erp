'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordWithdrawal } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { TagInput } from '@/components/ui/tag-input';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';
import { accountLabel } from '@/lib/account-label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PAYMENT_CATEGORIES } from './entry-categories';
import { SectionCard } from '@/components/dashboard/section-card';
import { AmountField, BalancePreview, RecentEntries, SubmitShortcut, type RecentEntry } from './entry-parts';

const initialState = { message: '', errors: {}, success: false };

const CURRENCIES = [
  { value: 'TOMAN', label: 'تومان' },
  { value: 'USD', label: 'دلار (USD)' },
  { value: 'EUR', label: 'یورو (EUR)' },
  { value: 'CNY', label: 'یوان (CNY)' },
];

interface Account {
  id: string;
  name: string;
  currency: string;
  balance: number;
  cardNumber?: string | null;
}

/** A recent payment; picking it fills the form with its payee, account, category and amount. */
export type RecentPayment = RecentEntry & {
  fill: { accountId: string; payee: string; category?: string };
};

export function WithdrawalForm({ accounts, recent = [] }: { accounts: Account[]; recent?: RecentPayment[] }) {
  const [state, dispatch] = useFormState(recordWithdrawal, initialState);
  const [requestId, renewRequestId] = useRequestId();
  // The currency follows the chosen account; there is no default to forget.
  const [currency, setCurrency] = useState('');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      setCurrency('');
      setAccountId('');
      setCategory('');
      setDate(new Date());
      setReceiptUrl('');
      setReceiptType('');
      setAmount('');
      setPayee('');
      // A new id, and a fresh form (it is keyed by the id), for the next entry.
      renewRequestId();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, renewRequestId]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const selectedAccount = accounts.find((a) => a.id === accountId);

  const chooseAccount = (id: string) => {
    setAccountId(id);
    setCurrency(accounts.find((a) => a.id === id)?.currency ?? '');
  };

  const repeat = (entry: RecentPayment) => {
    chooseAccount(entry.fill.accountId);
    setCurrency(entry.currency);
    setPayee(entry.fill.payee);
    setCategory(entry.fill.category ?? '');
    setAmount(String(entry.amount));
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border bg-card">
        <form key={requestId} action={dispatch}>
          <RequestIdField value={requestId} />
          <input type="hidden" name="receiptUrl" value={receiptUrl} />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 [&_label]:text-xs [&_label]:text-muted-foreground">
            <div className="sm:col-span-2">
              <AmountField
                label="مبلغ *"
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                step="0.01"
                min="0"
                placeholder="0"
                required
                error={errors?.amount?.[0]}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">حساب مبدأ *</Label>
              <Select name="accountId" value={accountId} onValueChange={chooseAccount} required>
                <SelectTrigger><SelectValue placeholder="از کدام حساب برداشت شود؟" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)} — موجودی: {a.balance.toLocaleString('fa-IR')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors?.accountId && <p className="text-xs text-danger">{errors.accountId[0]}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">ارز *</Label>
              <Select name="currency" value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue placeholder="ارز حساب" /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors?.currency && <p className="text-xs text-danger">{errors.currency[0]}</p>}
            </div>
            {selectedAccount && currency && currency !== selectedAccount.currency && (
              <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
                مبلغ به {currency} وارد می‌شود و با آخرین نرخ به ارز حساب ({selectedAccount.currency}) تبدیل می‌شود.
              </p>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="payee" className="text-xs text-muted-foreground">گیرنده (به چه کسی؟) *</Label>
              <Input
                id="payee"
                name="payee"
                placeholder="نام شخص، شرکت یا نهاد گیرنده..."
                required
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
              {errors?.payee && <p className="text-xs text-danger">{errors.payee[0]}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">دسته‌بندی (اختیاری)</Label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="دسته‌بندی">
                {PAYMENT_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={category === c}
                    onClick={() => setCategory(category === c ? '' : c)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
                      category === c ? 'border-brand bg-brand-soft font-medium text-brand' : 'bg-card text-muted-foreground hover:border-foreground/40',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input type="hidden" name="category" value={category} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description" className="text-xs text-muted-foreground">بابت چی؟</Label>
              <Textarea id="description" name="description" placeholder="شرح پرداخت..." rows={2} />
            </div>

            <JalaliDatePicker name="date" label="تاریخ پرداخت" defaultValue={date} onChange={(d) => d && setDate(d)} />

            <TagInput name="tags" label="تگ‌ها" placeholder="مثال: هزینه‌ثابت، اورژانسی..." />

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">سند / رسید (اختیاری)</Label>
              <ReceiptUpload
                onUploadComplete={(url, type) => { setReceiptUrl(url); setReceiptType(type); }}
                onRemove={() => { setReceiptUrl(''); setReceiptType(''); }}
                currentUrl={receiptUrl}
                currentType={receiptType}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-4 py-3 sm:px-5">
            <SubmitShortcut />
            <SubmitButton />
          </div>
        </form>
      </div>

      <div className="space-y-4">
        <SectionCard title="پیش‌نمایش">
          <BalancePreview account={selectedAccount} amount={Number(amount)} currency={currency} direction={-1} />
        </SectionCard>
        <SectionCard title="پرداخت‌های اخیر" aside={<span className="text-muted-foreground">برای تکرار بزنید</span>}>
          <RecentEntries entries={recent} onPick={repeat} empty="در ۳۰ روز گذشته پرداختی به گیرنده‌ای ثبت نشده است." />
        </SectionCard>
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'در حال ثبت...' : 'ثبت پرداخت'}
    </Button>
  );
}
