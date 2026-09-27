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
import { accountLabel } from '@/lib/account-label';

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
  cardNumber?: string | null;
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

      <div className="rounded-md bg-secondary px-3 py-2.5">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-muted-foreground">باقیمانده قرض</span>
            <span className="text-[17px] font-medium tabular-nums">
              {formatCurrency(loan.remaining)} <small className="text-[11px] font-normal text-muted-foreground">تومان</small>
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
                {accountLabel(account)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0]}</p>
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
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount?.[0]}</p>
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
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.date?.[0]}</p>
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
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.description?.[0]}</p>
        )}
      </div>

      {state.message && (
        <div
          className={`rounded-md px-3 py-2 text-[13px] ${state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
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

