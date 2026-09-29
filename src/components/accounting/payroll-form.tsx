'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createPayroll } from '@/actions/payroll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MONTH_NAMES, currentPeriod } from './payroll-periods';
import { toLatinDigits } from '@/lib/digits';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Employee {
  id: string;
  name: string;
  salary: number;
}

interface PayrollFormProps {
  employees: Employee[];
  onSuccess?: () => void;
}

/** A new payslip: employee, month and year, base pay, bonus and deductions. Shown in a dialog. */
export function PayrollForm({ employees, onSuccess }: PayrollFormProps) {
  const [state, dispatch] = useFormState(createPayroll, initialState);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [bonuses, setBonuses] = useState<string>('0');
  const [deductions, setDeductions] = useState<string>('0');

  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    // Only process if message has changed
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;

      if (state.success) {
        toast.success(state.message);
        if (onSuccess) {
          onSuccess();
        }
        // Reset form
        setSelectedEmployeeId('');
        setAmount('');
        setBonuses('0');
        setDeductions('0');
      } else {
        toast.error(state.message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.success]);

  // Auto-fill amount from employee salary when employee is selected
  useEffect(() => {
    if (selectedEmployeeId) {
      const employee = employees.find((e) => e.id === selectedEmployeeId);
      if (employee && !amount) {
        setAmount(employee.salary?.toString() || '');
      }
    }
  }, [selectedEmployeeId, employees, amount]);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const amountNum = Number(toLatinDigits(amount)) || 0;
  const bonusesNum = Number(toLatinDigits(bonuses)) || 0;
  const deductionsNum = Number(toLatinDigits(deductions)) || 0;
  const netAmount = amountNum + bonusesNum - deductionsNum;

  // The current Jalali month and year. (Reading them from Intl's fa-IR parts gave Persian
  // digits that parseInt cannot read, so the form always opened on month 1 of 1403.)
  const { year: currentYear, month: currentMonth } = currentPeriod();

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const FieldError = ({ name }: { name: string }) =>
    errors?.[name] ? <p className="text-[12.5px] text-danger">{errors[name]?.[0]}</p> : null;

  return (
    <form action={dispatch} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="employeeId">کارمند *</Label>
        <Select name="employeeId" required value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
          <SelectTrigger id="employeeId">
            <SelectValue placeholder="انتخاب کارمند" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError name="employeeId" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="periodMonth">ماه *</Label>
          <Select name="periodMonth" required defaultValue={currentMonth.toString()}>
            <SelectTrigger id="periodMonth">
              <SelectValue placeholder="انتخاب ماه" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <SelectItem key={month} value={month.toString()}>
                  {month.toLocaleString('fa-IR')} · {MONTH_NAMES[month - 1]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError name="periodMonth" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="periodYear">سال *</Label>
          <Input
            id="periodYear"
            name="periodYear"
            type="number"
            min="1400"
            placeholder="1403"
            required
            className="tabular-nums"
            defaultValue={currentYear.toString()}
          />
          <FieldError name="periodYear" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">مبلغ حقوق (تومان) *</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="0"
          required
          className="tabular-nums"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <FieldError name="amount" />
        {selectedEmployee && (
          <p className="text-xs text-muted-foreground">حقوق پایه: {selectedEmployee.salary?.toLocaleString('fa-IR')} تومان</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bonuses">پاداش (تومان)</Label>
          <Input
            id="bonuses"
            name="bonuses"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
            className="tabular-nums"
            value={bonuses}
            onChange={(e) => setBonuses(e.target.value)}
          />
          <FieldError name="bonuses" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="deductions">کسورات (تومان)</Label>
          <Input
            id="deductions"
            name="deductions"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
            className="tabular-nums"
            value={deductions}
            onChange={(e) => setDeductions(e.target.value)}
          />
          <FieldError name="deductions" />
        </div>
      </div>

      {amount && (
        <div className="flex items-center justify-between rounded-md bg-secondary px-3 py-2.5">
          <span className="text-[13px] text-muted-foreground">خالص قابل پرداخت</span>
          <span className="text-[15px] font-medium tabular-nums">{netAmount.toLocaleString('fa-IR')} تومان</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="description">توضیحات</Label>
        <Textarea id="description" name="description" placeholder="توضیحات (اختیاری)..." rows={3} />
        <FieldError name="description" />
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
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت فیش حقوقی'}
    </Button>
  );
}
