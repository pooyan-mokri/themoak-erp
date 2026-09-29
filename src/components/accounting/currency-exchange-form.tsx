'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Currency } from '@/lib/types';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useEffect, useState } from 'react';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';
import { accountLabel } from '@/lib/account-label';
import { cn } from '@/lib/utils';
import { localDateString } from '@/lib/date-utils';

const initialState = {
  message: '',
  errors: {} as Record<string, string[]>,
  success: false,
} as const;

interface CurrencyExchangeFormProps {
  accounts: Array<{
    id: string;
    name: string;
    currency: Currency;
    balance: number;
    cardNumber?: string | null;
  }>;
}

/**
 * Which accounts each side may be: buying spends Toman for a currency, selling
 * turns a currency into Toman, and a cross trade swaps one currency for another.
 * The toggle only narrows the two pickers; the server checks the pair again.
 */
const MODES = [
  { id: 'buy', label: 'خرید ارز', hint: 'از حساب تومان برداشت و به حساب ارزی واریز می‌شود.' },
  { id: 'sell', label: 'فروش ارز', hint: 'از حساب ارزی برداشت و به حساب تومان واریز می‌شود.' },
  { id: 'cross', label: 'ارز به ارز', hint: 'از یک حساب ارزی به حساب ارزی دیگر؛ هر طرف با نرخ ثبت‌شده‌اش به تومان ارزش‌گذاری می‌شود.' },
] as const;
type Mode = (typeof MODES)[number]['id'];

const fa = (n: number, digits = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);

export function CurrencyExchangeForm({ accounts }: CurrencyExchangeFormProps) {
  const [state, dispatch] = useFormState(exchangeCurrency, initialState);
  const [requestId, renewRequestId] = useRequestId();
  const [mode, setMode] = useState<Mode>('buy');
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [targetAmount, setTargetAmount] = useState<string>('');
  const [exchangeRate, setExchangeRate] = useState<string>('');
  const [date, setDate] = useState<string>('');

  const clearTrade = () => {
    setSourceAccountId('');
    setTargetAccountId('');
    setSourceAmount('');
    setTargetAmount('');
    setExchangeRate('');
  };

  // After a save the form is emptied and gets a new id (it is keyed by it), so
  // the same exchange cannot be sent twice and the next one starts clean.
  useEffect(() => {
    if (!state.success) return;
    clearTrade();
    setDate('');
    renewRequestId();
  }, [state, renewRequestId]);

  // Get selected accounts
  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const targetAccount = accounts.find((a) => a.id === targetAccountId);

  // The rate is ALWAYS expressed as Toman per 1 unit of the foreign currency
  // (e.g. 176,800 تومان per 1 USD). The inverse direction (USD per Toman) is a
  // number like 0.0000056, which loses ~6% of its value once rounded and falls
  // below the minimum the form and the server accept.
  const isBuying = sourceAccount?.currency === Currency.TOMAN && targetAccount?.currency !== Currency.TOMAN;
  const isSelling = targetAccount?.currency === Currency.TOMAN && sourceAccount?.currency !== Currency.TOMAN;
  const hasTomanSide = isBuying || isSelling;
  const foreignCurrency = isBuying ? targetAccount?.currency : sourceAccount?.currency;

  const round = (n: number, digits: number) =>
    Number.isFinite(n) ? String(Number(n.toFixed(digits))) : '';

  // Amount of the foreign currency, given a Toman amount and a rate.
  const foreignFromToman = (toman: string, rate: string) => {
    const t = Number(toman);
    const r = Number(rate);
    return t > 0 && r > 0 ? round(t / r, 2) : '';
  };

  const rateFromAmounts = (toman: string, foreign: string) => {
    const t = Number(toman);
    const f = Number(foreign);
    return t > 0 && f > 0 ? round(t / f, 2) : '';
  };

  const handleSourceAmountChange = (value: string) => {
    setSourceAmount(value);
    if (!hasTomanSide) return;
    if (isBuying) {
      // Toman side edited: derive the foreign amount from the rate.
      if (exchangeRate) setTargetAmount(foreignFromToman(value, exchangeRate));
      else if (targetAmount) setExchangeRate(rateFromAmounts(value, targetAmount));
    } else {
      // Foreign side edited: the rate follows from the two amounts.
      if (targetAmount) setExchangeRate(rateFromAmounts(targetAmount, value));
    }
  };

  const handleTargetAmountChange = (value: string) => {
    setTargetAmount(value);
    if (!hasTomanSide) return;
    if (isSelling) {
      if (exchangeRate) setSourceAmount(foreignFromToman(value, exchangeRate));
      else if (sourceAmount) setExchangeRate(rateFromAmounts(value, sourceAmount));
    } else {
      if (sourceAmount) setExchangeRate(rateFromAmounts(sourceAmount, value));
    }
  };

  const handleRateChange = (value: string) => {
    setExchangeRate(value);
    if (!hasTomanSide) return;
    // Keep the foreign amount consistent with the Toman amount and the rate,
    // so "how much currency did I actually buy" is never computed by hand.
    if (isBuying && sourceAmount) setTargetAmount(foreignFromToman(sourceAmount, value));
    if (isSelling && targetAmount) setSourceAmount(foreignFromToman(targetAmount, value));
  };

  // The accounts each picker offers in the chosen mode.
  const tomanAccounts = accounts.filter((a) => a.currency === Currency.TOMAN);
  const foreignAccounts = accounts.filter((a) => a.currency !== Currency.TOMAN);
  const sourceAccounts = mode === 'buy' ? tomanAccounts : foreignAccounts;
  const targetAccounts = (mode === 'sell' ? tomanAccounts : foreignAccounts).filter(
    (a) => mode !== 'cross' || !sourceAccount || a.currency !== sourceAccount.currency,
  );

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const FieldError = ({ name }: { name: string }) =>
    errors?.[name]?.[0] ? <p className="text-[12.5px] text-danger">{errors[name]?.[0]}</p> : null;

  const src = Number(sourceAmount) || 0;
  const dst = Number(targetAmount) || 0;
  const short = !!sourceAccount && src > Number(sourceAccount.balance);
  const unit = (currency?: Currency) => (!currency || currency === Currency.TOMAN ? 'تومان' : currency);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">معامله ارز جدید</h3>
      </div>
      <div className="mb-2 inline-flex rounded-md border bg-secondary p-[3px]" role="tablist" aria-label="نوع معامله">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              if (mode === m.id) return;
              setMode(m.id);
              clearTrade();
            }}
            className={cn(
              'h-[30px] rounded-[6px] px-3.5 text-[13px] transition-colors duration-150',
              mode === m.id ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-[12.5px] text-muted-foreground">{MODES.find((m) => m.id === mode)!.hint}</p>

      <form key={requestId} action={dispatch}>
        <RequestIdField value={requestId} />
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Source Account */}
            <div className="space-y-1.5">
              <Label htmlFor="sourceAccountId">حساب مبدأ (برداشت از)</Label>
              <Select
                name="sourceAccountId"
                value={sourceAccountId}
                onValueChange={(id) => {
                  setSourceAccountId(id);
                  // In a cross trade the target must be another currency.
                  const picked = accounts.find((a) => a.id === id);
                  if (mode === 'cross' && picked && targetAccount?.currency === picked.currency) setTargetAccountId('');
                }}
                required
              >
                <SelectTrigger id="sourceAccountId">
                  <SelectValue placeholder="انتخاب حساب مبدأ" />
                </SelectTrigger>
                <SelectContent>
                  {sourceAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountLabel(account)} - موجودی:{' '}
                      {new Intl.NumberFormat('fa-IR').format(Number(account.balance))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError name="sourceAccountId" />
              {sourceAccounts.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  حساب {mode === 'buy' ? 'تومانی' : 'ارزی'} تعریف نشده است؛ اول آن را در صفحه حساب‌ها بسازید.
                </p>
              )}
            </div>

            {/* Target Account */}
            <div className="space-y-1.5">
              <Label htmlFor="targetAccountId">حساب مقصد (واریز به)</Label>
              <Select
                name="targetAccountId"
                value={targetAccountId}
                onValueChange={setTargetAccountId}
                required
              >
                <SelectTrigger id="targetAccountId">
                  <SelectValue placeholder="انتخاب حساب مقصد" />
                </SelectTrigger>
                <SelectContent>
                  {targetAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountLabel(account)} - موجودی:{' '}
                      {new Intl.NumberFormat('fa-IR').format(Number(account.balance))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError name="targetAccountId" />
            </div>

            {/* Source Amount */}
            <div className="space-y-1.5">
              <Label htmlFor="sourceAmount">
                مبلغ برداشت{sourceAccount ? ` (${unit(sourceAccount.currency)})` : ''}
              </Label>
              <Input
                id="sourceAmount"
                name="sourceAmount"
                type="number"
                step="0.01"
                min="0.01"
                dir="ltr"
                className="tabular-nums"
                value={sourceAmount}
                onChange={(e) => handleSourceAmountChange(e.target.value)}
                placeholder="0.00"
                required
              />
              <FieldError name="sourceAmount" />
            </div>

            {/* Target Amount */}
            <div className="space-y-1.5">
              <Label htmlFor="targetAmount">
                مبلغ واریز{targetAccount ? ` (${unit(targetAccount.currency)})` : ''}
              </Label>
              <Input
                id="targetAmount"
                name="targetAmount"
                type="number"
                step="0.01"
                min="0.01"
                dir="ltr"
                className="tabular-nums"
                value={targetAmount}
                onChange={(e) => handleTargetAmountChange(e.target.value)}
                placeholder="0.00"
                required
              />
              <FieldError name="targetAmount" />
            </div>

            {/* Exchange Rate */}
            <div className="space-y-1.5">
              <Label htmlFor="exchangeRate">
                {hasTomanSide && foreignCurrency
                  ? `نرخ تبدیل (تومان به ازای هر ۱ ${foreignCurrency})`
                  : 'نرخ تبدیل'}
              </Label>
              <Input
                id="exchangeRate"
                name="exchangeRate"
                type="number"
                step="0.000001"
                min="0.01"
                dir="ltr"
                className="tabular-nums"
                value={exchangeRate}
                onChange={(e) => handleRateChange(e.target.value)}
                placeholder="نرخ تبدیل"
                required
              />
              <FieldError name="exchangeRate" />
              {sourceAccount && targetAccount && exchangeRate && (
                <p className="text-[12px] text-muted-foreground">
                  {hasTomanSide && foreignCurrency
                    ? `۱ ${foreignCurrency} = ${new Intl.NumberFormat('fa-IR').format(Number(exchangeRate))} تومان`
                    : `1 ${sourceAccount.currency} = ${Number(exchangeRate)} ${targetAccount.currency}`}
                </p>
              )}
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="date">تاریخ</Label>
              <JalaliDatePicker
                name="date"
                defaultValue={date ? new Date(date) : undefined}
                onChange={(selectedDate) => {
                  setDate(selectedDate ? localDateString(selectedDate) : '');
                }}
              />
              <input type="hidden" name="date" value={date} />
            </div>
          </div>

          {/* Hidden fields for currency types */}
          <input
            type="hidden"
            name="sourceCurrency"
            value={sourceAccount?.currency || ''}
          />
          <input
            type="hidden"
            name="targetCurrency"
            value={targetAccount?.currency || ''}
          />

          {/* Before and after, on both accounts */}
          {sourceAccount && targetAccount && (
            <dl className="space-y-1.5 rounded-md bg-secondary px-3 py-2.5 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{sourceAccount.name}</dt>
                <dd className="tabular-nums">
                  {fa(Number(sourceAccount.balance))} ← <b className="font-medium">{fa(Number(sourceAccount.balance) - src)}</b>{' '}
                  <span className="text-muted-foreground">{unit(sourceAccount.currency)}</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{targetAccount.name}</dt>
                <dd className="tabular-nums">
                  {fa(Number(targetAccount.balance))} ← <b className="font-medium">{fa(Number(targetAccount.balance) + dst)}</b>{' '}
                  <span className="text-muted-foreground">{unit(targetAccount.currency)}</span>
                </dd>
              </div>
              {short && (
                <p className="pt-1">
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">موجودی مبدأ کافی نیست</span>
                </p>
              )}
            </dl>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">توضیحات (اختیاری)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="توضیحات معامله..."
              rows={3}
            />
          </div>

          {state.message && (
            <div
              className={cn(
                'rounded-md px-3 py-2 text-[13px]',
                state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
              )}
            >
              {state.message}
            </div>
          )}

          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </div>
      </form>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت معامله ارز'}
    </Button>
  );
}
