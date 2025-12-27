'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createLoan } from '@/actions/loan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Employee {
  id: string;
  name: string;
}

interface LoanFormProps {
  employees: Employee[];
}

export function LoanForm({ employees }: LoanFormProps) {
  const [state, dispatch] = useFormState(createLoan, initialState);
  const [dueDate, setDueDate] = useState<string>('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      // Reset form
      setDueDate('');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت قرض جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="borrowerId">کارمند *</Label>
            <Select name="borrowerId" required>
              <SelectTrigger id="borrowerId">
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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.borrowerId && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.borrowerId[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">مبلغ قرض (تومان) *</Label>
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
            <Label htmlFor="interestRate">نرخ بهره سالانه (%)</Label>
            <Input
              id="interestRate"
              name="interestRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="0"
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.interestRate && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.interestRate[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">تاریخ سررسید</Label>
            <JalaliDatePicker
              name="dueDate"
              defaultValue={dueDate ? new Date(dueDate) : undefined}
              onChange={(selectedDate) => {
                setDueDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
              }}
            />
            <input type="hidden" name="dueDate" value={dueDate} />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.dueDate && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.dueDate[0]}</p>
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
      {pending ? 'در حال ثبت...' : 'ثبت قرض'}
    </Button>
  );
}

