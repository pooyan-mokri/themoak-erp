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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useState, useEffect } from 'react';
import { getAccounts } from '@/actions/accounting';

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
  }>;
}

export function CurrencyExchangeForm({ accounts }: CurrencyExchangeFormProps) {
  const [state, dispatch] = useFormState(exchangeCurrency, initialState);
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [targetAmount, setTargetAmount] = useState<string>('');
  const [exchangeRate, setExchangeRate] = useState<string>('');
  const [date, setDate] = useState<string>('');

  // Get selected accounts
  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const targetAccount = accounts.find((a) => a.id === targetAccountId);

  // Calculate exchange rate when amounts change
  useEffect(() => {
    if (sourceAmount && targetAmount && sourceAccount && targetAccount && Number(sourceAmount) > 0 && Number(targetAmount) > 0) {
      if (sourceAccount.currency === Currency.TOMAN) {
        // Buying foreign currency: 1 TOMAN = ? foreign currency
        // rate = targetAmount / sourceAmount (how much foreign currency per 1 TOMAN)
        const rate = Number(targetAmount) / Number(sourceAmount);
        setExchangeRate(rate.toFixed(6));
      } else if (targetAccount.currency === Currency.TOMAN) {
        // Selling foreign currency: 1 foreign currency = ? TOMAN
        // rate = targetAmount / sourceAmount (how much TOMAN per 1 foreign currency)
        const rate = Number(targetAmount) / Number(sourceAmount);
        setExchangeRate(rate.toFixed(6));
      } else {
        // Foreign to foreign: convert through TOMAN
        // This is more complex, user should enter rate manually
      }
    }
  }, [sourceAmount, targetAmount, sourceAccount, targetAccount]);

  // Filter accounts by currency
  const tomanAccounts = accounts.filter((a) => a.currency === Currency.TOMAN);
  const foreignAccounts = accounts.filter((a) => a.currency !== Currency.TOMAN);

  return (
    <Card>
      <CardHeader>
        <CardTitle>خرید و فروش ارز</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Account */}
            <div className="space-y-2">
              <Label htmlFor="sourceAccountId">حساب مبدا (برداشت از)</Label>
              <Select
                name="sourceAccountId"
                value={sourceAccountId}
                onValueChange={setSourceAccountId}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب مبدا" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currency}) - موجودی:{' '}
                      {new Intl.NumberFormat('fa-IR').format(Number(account.balance))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.errors && 'sourceAccountId' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.sourceAccountId?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.sourceAccountId?.[0]}</p>
              )}
              {sourceAccount && (
                <p className="text-xs text-muted-foreground">
                  نوع ارز: {sourceAccount.currency}
                </p>
              )}
            </div>

            {/* Target Account */}
            <div className="space-y-2">
              <Label htmlFor="targetAccountId">حساب مقصد (واریز به)</Label>
              <Select
                name="targetAccountId"
                value={targetAccountId}
                onValueChange={setTargetAccountId}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب مقصد" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currency}) - موجودی:{' '}
                      {new Intl.NumberFormat('fa-IR').format(Number(account.balance))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.errors && 'targetAccountId' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.targetAccountId?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.targetAccountId?.[0]}</p>
              )}
              {targetAccount && (
                <p className="text-xs text-muted-foreground">
                  نوع ارز: {targetAccount.currency}
                </p>
              )}
            </div>

            {/* Source Amount */}
            <div className="space-y-2">
              <Label htmlFor="sourceAmount">
                مبلغ {sourceAccount?.currency || 'مبدا'}
              </Label>
              <Input
                id="sourceAmount"
                name="sourceAmount"
                type="number"
                step="0.01"
                min="0.01"
                value={sourceAmount}
                onChange={(e) => setSourceAmount(e.target.value)}
                placeholder="0.00"
                required
              />
              {state.errors && 'sourceAmount' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.sourceAmount?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.sourceAmount?.[0]}</p>
              )}
              {sourceAccount && sourceAmount && (
                <p className="text-xs text-muted-foreground">
                  موجودی: {new Intl.NumberFormat('fa-IR').format(Number(sourceAccount.balance))}{' '}
                  {sourceAccount.currency}
                </p>
              )}
            </div>

            {/* Target Amount */}
            <div className="space-y-2">
              <Label htmlFor="targetAmount">
                مبلغ {targetAccount?.currency || 'مقصد'}
              </Label>
              <Input
                id="targetAmount"
                name="targetAmount"
                type="number"
                step="0.01"
                min="0.01"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="0.00"
                required
              />
              {state.errors && 'targetAmount' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.targetAmount?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.targetAmount?.[0]}</p>
              )}
            </div>

            {/* Exchange Rate */}
            <div className="space-y-2">
              <Label htmlFor="exchangeRate">نرخ تبدیل</Label>
              <Input
                id="exchangeRate"
                name="exchangeRate"
                type="number"
                step="0.000001"
                min="0.01"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                placeholder="نرخ تبدیل"
                required
              />
              {state.errors && 'exchangeRate' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.exchangeRate?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.exchangeRate?.[0]}</p>
              )}
              {sourceAccount && targetAccount && exchangeRate && (
                <p className="text-xs text-muted-foreground">
                  1 {sourceAccount.currency} = {Number(exchangeRate).toFixed(6)}{' '}
                  {targetAccount.currency === Currency.TOMAN ? 'تومان' : targetAccount.currency}
                </p>
              )}
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="date">تاریخ</Label>
              <JalaliDatePicker
                name="date"
                defaultValue={date ? new Date(date) : undefined}
                onChange={(selectedDate) => {
                  setDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
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

          {/* Description */}
          <div className="space-y-2">
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
              className={`text-sm p-3 rounded ${
                state.success
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
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

