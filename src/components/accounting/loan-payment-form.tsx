'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordLoanPayment } from '@/actions/loan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Loan {
  id: string;
  employee: {
    name: string;
  };
  remaining: number;
  interestRate: number;
}

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface LoanPaymentFormProps {
  loan: Loan;
  accounts: Account[];
  onSuccess?: () => void;
}

export function LoanPaymentForm({
  loan,
  accounts,
  onSuccess,
}: LoanPaymentFormProps) {
  const [state, dispatch] = useFormState(recordLoanPayment, initialState);
  const [accountId, setAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      if (onSuccess) onSuccess();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, onSuccess]);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount));
  };

  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="loanId" value={loan.id} />

      <div className="p-3 bg-muted rounded-md">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">باقیمانده قرض:</span>
            <span className="text-lg font-bold text-orange-600">
              {formatCurrency(loan.remaining)} تومان
            </span>
          </div>
          {loan.interestRate > 0 && (
            <div className="text-xs text-muted-foreground">
              نرخ بهره: {loan.interestRate.toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="accountId">حساب دریافت پرداخت *</Label>
        <Select name="accountId" required value={accountId} onValueChange={setAccountId}>
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
          <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">مبلغ پرداخت *</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          max={loan.remaining}
          placeholder="0"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && (
          <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount?.[0]}</p>
        )}
        <p className="text-xs text-muted-foreground">
          حداکثر: {formatCurrency(loan.remaining)} تومان
        </p>
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

      <div className="flex justify-end gap-2">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت پرداخت'}
    </Button>
  );
}

