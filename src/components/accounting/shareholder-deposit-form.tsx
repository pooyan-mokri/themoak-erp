'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { depositShareholderFunds } from '@/actions/shareholder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Shareholder {
  id: string;
  name: string;
  percentage: number;
}

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface ShareholderDepositFormProps {
  shareholders: Shareholder[];
  accounts: Account[];
}

export function ShareholderDepositForm({
  shareholders,
  accounts,
}: ShareholderDepositFormProps) {
  const [state, dispatch] = useFormState(depositShareholderFunds, initialState);
  const [shareholderId, setShareholderId] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [currency, setCurrency] = useState<string>('TOMAN');
  const [date, setDate] = useState<string>('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      // Reset form
      setShareholderId('');
      setAccountId('');
      setCurrency('TOMAN');
      setDate('');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  // Update currency when account changes
  useEffect(() => {
    if (accountId) {
      const selectedAccount = accounts.find((a) => a.id === accountId);
      if (selectedAccount) {
        setCurrency(selectedAccount.currency);
      }
    }
  }, [accountId, accounts]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>واریز سرمایه توسط صاحب سهام</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          وقتی سهامدار پول واریز می‌کند، از سیستم طلبکار می‌شود (Accounts Payable).
        </p>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shareholderId">صاحب سهام *</Label>
            <Select
              name="shareholderId"
              required
              value={shareholderId}
              onValueChange={setShareholderId}
            >
              <SelectTrigger id="shareholderId">
                <SelectValue placeholder="انتخاب صاحب سهام" />
              </SelectTrigger>
              <SelectContent>
                {shareholders.map((shareholder) => (
                  <SelectItem key={shareholder.id} value={shareholder.id}>
                    {shareholder.name} ({shareholder.percentage.toFixed(2)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(state.errors as Record<string, string[] | undefined> | undefined)?.shareholderId && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.shareholderId[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountId">حساب واریزی *</Label>
            <Select
              name="accountId"
              required
              value={accountId}
              onValueChange={setAccountId}
            >
              <SelectTrigger id="accountId">
                <SelectValue placeholder="انتخاب حساب" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">مبلغ *</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                required
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">ارز *</Label>
              <Select name="currency" required value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder="انتخاب ارز" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Currency.TOMAN}>تومان</SelectItem>
                  <SelectItem value={Currency.USD}>دلار</SelectItem>
                  <SelectItem value={Currency.EUR}>یورو</SelectItem>
                  <SelectItem value={Currency.CNY}>یوآن</SelectItem>
                </SelectContent>
              </Select>
              {(state.errors as Record<string, string[] | undefined> | undefined)?.currency && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.currency[0]}</p>
              )}
            </div>
          </div>

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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.date && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.date[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">توضیحات</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="توضیحات (اختیاری)..."
              rows={3}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.description && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.description[0]}</p>
            )}
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
      {pending ? 'در حال واریز...' : 'ثبت واریز'}
    </Button>
  );
}

