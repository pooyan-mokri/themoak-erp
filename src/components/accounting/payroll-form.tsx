'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createPayroll } from '@/actions/payroll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

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
  const amountNum = Number(amount) || 0;
  const bonusesNum = Number(bonuses) || 0;
  const deductionsNum = Number(deductions) || 0;
  const netAmount = amountNum + bonusesNum - deductionsNum;

  // Get current Jalali month and year
  const now = new Date();
  const jalaliDate = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const yearValue = jalaliDate.find((p) => p.type === 'year')?.value || '1403';
  const monthValue = jalaliDate.find((p) => p.type === 'month')?.value || '1';
  const currentYear = parseInt(yearValue, 10) || 1403;
  const currentMonth = parseInt(monthValue, 10) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت فیش حقوقی جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employeeId">کارمند *</Label>
            <Select
              name="employeeId"
              required
              value={selectedEmployeeId}
              onValueChange={setSelectedEmployeeId}
            >
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
            {state.errors?.employeeId && (
              <p className="text-red-500 text-sm">{state.errors.employeeId[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="periodMonth">ماه *</Label>
              <Select name="periodMonth" required defaultValue={currentMonth.toString()}>
                <SelectTrigger id="periodMonth">
                  <SelectValue placeholder="انتخاب ماه" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <SelectItem key={month} value={month.toString()}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.errors?.periodMonth && (
                <p className="text-red-500 text-sm">{state.errors.periodMonth[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="periodYear">سال *</Label>
              <Input
                id="periodYear"
                name="periodYear"
                type="number"
                min="1400"
                placeholder="1403"
                required
                defaultValue={currentYear ? currentYear.toString() : '1403'}
              />
              {state.errors?.periodYear && (
                <p className="text-red-500 text-sm">{state.errors.periodYear[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">مبلغ حقوق (تومان) *</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {state.errors?.amount && (
              <p className="text-red-500 text-sm">{state.errors.amount[0]}</p>
            )}
            {selectedEmployee && (
              <p className="text-xs text-muted-foreground">
                حقوق پایه: {selectedEmployee.salary?.toLocaleString('fa-IR')} تومان
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bonuses">پاداش (تومان)</Label>
              <Input
                id="bonuses"
                name="bonuses"
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                value={bonuses}
                onChange={(e) => setBonuses(e.target.value)}
              />
              {state.errors?.bonuses && (
                <p className="text-red-500 text-sm">{state.errors.bonuses[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="deductions">کسورات (تومان)</Label>
              <Input
                id="deductions"
                name="deductions"
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                value={deductions}
                onChange={(e) => setDeductions(e.target.value)}
              />
              {state.errors?.deductions && (
                <p className="text-red-500 text-sm">{state.errors.deductions[0]}</p>
              )}
            </div>
          </div>

          {amount && (
            <div className="p-3 bg-muted rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">خالص قابل پرداخت:</span>
                <span className="text-lg font-bold text-green-600">
                  {netAmount.toLocaleString('fa-IR')} تومان
                </span>
              </div>
            </div>
          )}

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
      {pending ? 'در حال ثبت...' : 'ثبت فیش حقوقی'}
    </Button>
  );
}

