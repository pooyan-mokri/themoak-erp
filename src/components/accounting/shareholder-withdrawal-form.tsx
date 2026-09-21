'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { withdrawShareholderFunds } from '@/actions/shareholder';
import { withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';
import { accountLabel } from '@/lib/account-label';

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
  cardNumber?: string | null;
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

/**
 * Paying out a profit goes through withdrawShareholderProfit, which marks the
 * profit as withdrawn so it cannot be paid again; without a profit it is a
 * capital withdrawal that the shareholder owes back.
 */
export function withdrawalActionFor(profit?: { id: string }) {
  return profit ? withdrawShareholderProfit : withdrawShareholderFunds;
}

export function ShareholderWithdrawalForm({
  shareholders,
  accounts,
  profit,
  onSuccess,
}: ShareholderWithdrawalFormProps) {
  const [state, dispatch] = useFormState(withdrawalActionFor(profit), initialState);
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
        <CardTitle>{profit ? 'پرداخت سود به صاحب سهام' : 'برداشت سرمایه توسط صاحب سهام'}</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          {profit
            ? `مبلغ به تومان از سود این دوره کم می‌شود. قابل برداشت: ${Math.round(profit.available).toLocaleString('fa-IR')} تومان`
            : 'وقتی سهامدار پول برداشت می‌کند، به سیستم بدهکار می‌شود.'}
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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.shareholderId && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.shareholderId?.[0]}</p>
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
                    {accountLabel(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="accountId" value={accountId} />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">{profit ? 'مبلغ (تومان) *' : 'مبلغ *'}</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                max={profit ? profit.available : undefined}
                placeholder="0"
                required
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount?.[0]}</p>
              )}
            </div>

            {/* A profit is kept in Toman; the payout is converted into the account's currency. */}
            {!profit && (
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
                {(state.errors as Record<string, string[] | undefined> | undefined)?.currency && (
                  <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.currency?.[0]}</p>
                )}
              </div>
            )}
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
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.date?.[0]}</p>
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
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.description?.[0]}</p>
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
