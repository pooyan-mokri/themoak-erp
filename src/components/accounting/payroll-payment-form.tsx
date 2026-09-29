'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordPayrollPayment } from '@/actions/payroll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';
import { accountLabel } from '@/lib/account-label';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';
import { localDateString } from '@/lib/date-utils';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Payroll {
  id: string;
  employee: {
    name: string;
  };
  netAmount: number;
  paidAmount: number;
  periodMonth: number;
  periodYear: number;
}

interface Account {
  id: string;
  name: string;
  currency: string;
  cardNumber?: string | null;
}

interface PayrollPaymentFormProps {
  payroll: Payroll;
  accounts: Account[];
  onSuccess?: () => void;
}

export function PayrollPaymentForm({
  payroll,
  accounts,
  onSuccess,
}: PayrollPaymentFormProps) {
  const [state, dispatch] = useFormState(recordPayrollPayment, initialState);
  // One id per submission, so a retry or a double click books once (src/lib/request-id.ts);
  // a new one once this is booked, so the next entry is a new submission.
  const [requestId, renewRequestId] = useRequestId();
  useEffect(() => {
    if (state.success) renewRequestId();
  }, [state, renewRequestId]);
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

  const remainingAmount = payroll.netAmount - payroll.paidAmount;

  const monthNames = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  return (
    <form action={dispatch} className="space-y-4">
      <RequestIdField value={requestId} />
      <input type="hidden" name="payrollId" value={payroll.id} />

      <dl className="space-y-1.5 rounded-md bg-secondary p-3 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">خالص قابل پرداخت</dt>
          <dd className="tabular-nums">{formatCurrency(payroll.netAmount)} تومان</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">پرداخت شده</dt>
          <dd className="tabular-nums">{formatCurrency(payroll.paidAmount)} تومان</dd>
        </div>
        <div className="flex items-center justify-between border-t pt-1.5">
          <dt className="font-medium">باقیمانده</dt>
          <dd className="text-[15px] font-medium tabular-nums">{formatCurrency(remainingAmount)} تومان</dd>
        </div>
      </dl>

      <div className="space-y-1.5">
        <Label htmlFor="accountId">حساب پرداخت *</Label>
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

      <div className="space-y-1.5">
        <Label htmlFor="amount">مبلغ پرداخت (تومان) *</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          max={remainingAmount}
          placeholder="0"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && (
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount?.[0]}</p>
        )}
        <p className="text-xs text-muted-foreground">
          حداکثر: {formatCurrency(remainingAmount)} تومان
        </p>
      </div>

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
        {(state.errors as Record<string, string[] | undefined> | undefined)?.date && (
          <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.date?.[0]}</p>
        )}
      </div>

      <div className="space-y-1.5">
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
          className={`rounded-md px-3 py-2 text-[13px] ${
            state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
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

