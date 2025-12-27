'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { calculateShareholderProfits } from '@/actions/shareholder-profit';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';
import { Calculator } from 'lucide-react';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

export function ShareholderProfitForm() {
  const [state, dispatch] = useFormState(calculateShareholderProfits, initialState);
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      // Reset form
      setPeriodStart('');
      setPeriodEnd('');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>محاسبه خودکار سود قابل برداشت</CardTitle>
        <CardDescription>
          سود شرکت در دوره انتخابی محاسبه شده و بر اساس درصد سهام هر سهامدار تقسیم می‌شود
        </CardDescription>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="periodStart">تاریخ شروع دوره *</Label>
              <JalaliDatePicker
                name="periodStart"
                defaultValue={periodStart ? new Date(periodStart) : undefined}
                onChange={(selectedDate) => {
                  setPeriodStart(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="periodStart" value={periodStart} />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.periodStart && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.periodStart[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="periodEnd">تاریخ پایان دوره *</Label>
              <JalaliDatePicker
                name="periodEnd"
                defaultValue={periodEnd ? new Date(periodEnd) : undefined}
                onChange={(selectedDate) => {
                  setPeriodEnd(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="periodEnd" value={periodEnd} />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.periodEnd && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.periodEnd[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">توضیحات (اختیاری)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="توضیحات..."
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
      <Calculator className="h-4 w-4 ml-2" />
      {pending ? 'در حال محاسبه...' : 'محاسبه سود'}
    </Button>
  );
}

