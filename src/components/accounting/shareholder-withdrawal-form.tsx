'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { withdrawShareholderFunds } from '@/actions/shareholder';
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

interface ShareholderProfit {
  id: string;
  shareholder: Shareholder;
  amount: number;
  withdrawn: number;
  available: number;
}

interface ShareholderWithdrawalFormProps {
  shareholders?: Shareholder[];
  accounts: Account[];
  profit?: ShareholderProfit;
  onSuccess?: () => void;
}

export function ShareholderWithdrawalForm({
  shareholders,
  accounts,
  profit,
  onSuccess,
}: ShareholderWithdrawalFormProps) {
  const [state, dispatch] = useFormState(withdrawShareholderFunds, initialState);
  const [shareholderId, setShareholderId] = useState<string>(profit?.shareholder.id || '');
  const [accountId, setAccountId] = useState<string>('');
  const [currency, setCurrency] = useState<string>('TOMAN');
  const [date, setDate] = useState<string>('');
  const lastMessageRef = useRef('');

  // Get shareholders list - either from prop or from profit
  const shareholdersList = shareholders || (profit ? [profit.shareholder] : []);

  useEffect(() => {
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      
      if (state.success) {
        toast.success(state.message);
        // Reset form
        if (!profit) {
          setShareholderId('');
        }
        setAccountId('');
        setCurrency('TOMAN');
        setDate('');
        // Call onSuccess callback if provided
        if (onSuccess) {
          onSuccess();
        }
      } else {
        toast.error(state.message);
      }
    }
  }, [state.message, state.success, profit, onSuccess]);

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
        <CardTitle>برداشت سرمایه توسط صاحب سهام</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          وقتی سهامدار پول برداشت می‌کند، به سیستم بدهکار می‌شود.
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
              disabled={!!profit}
            >
              <SelectTrigger id="shareholderId">
                <SelectValue placeholder="انتخاب صاحب سهام" />
              </SelectTrigger>
              <SelectContent>
                {shareholdersList.map((shareholder) => (
                  <SelectItem key={shareholder.id} value={shareholder.id}>
                    {shareholder.name} ({shareholder.percentage.toFixed(2)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="shareholderId" value={shareholderId} />
            {profit && (
              <input type="hidden" name="profitId" value={profit.id} />
            )}
            {state.errors?.shareholderId && (
              <p className="text-red-500 text-sm">{state.errors.shareholderId[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="accountId">حساب پرداخت *</Label>
            <Select
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
            <input type="hidden" name="accountId" value={accountId} />
            {state.errors?.accountId && (
              <p className="text-red-500 text-sm">{state.errors.accountId[0]}</p>
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
              {state.errors?.amount && (
                <p className="text-red-500 text-sm">{state.errors.amount[0]}</p>
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
              <input type="hidden" name="currency" value={currency} />
              {state.errors?.currency && (
                <p className="text-red-500 text-sm">{state.errors.currency[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">تاریخ</Label>
            <JalaliDatePicker
              name="date"
              defaultValue={date ? new Date(date) : null}
              onChange={(selectedDate) => {
                setDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
              }}
            />
            <input type="hidden" name="date" value={date} />
            {state.errors?.date && (
              <p className="text-red-500 text-sm">{state.errors.date[0]}</p>
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
            {state.errors?.description && (
              <p className="text-red-500 text-sm">{state.errors.description[0]}</p>
            )}
          </div>
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
      {pending ? 'در حال پرداخت...' : 'ثبت برداشت'}
    </Button>
  );
}
