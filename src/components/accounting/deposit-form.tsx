'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordDeposit } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { TagInput } from '@/components/ui/tag-input';
import { toast } from 'sonner';

const initialState = { message: '', errors: {}, success: false };

const CURRENCIES = [
  { value: 'TOMAN', label: 'تومان' },
  { value: 'USD', label: 'دلار آمریکا (USD)' },
  { value: 'EUR', label: 'یورو (EUR)' },
  { value: 'CNY', label: 'یوان چین (CNY)' },
];

const CATEGORIES = [
  'واریز نقدی',
  'واریز بانکی',
  'برگشت وجه',
  'دریافت از مشتری',
  'سرمایه‌گذاری',
  'وام دریافتی',
  'سایر',
];

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface DepositFormProps {
  accounts: Account[];
}

export function DepositForm({ accounts }: DepositFormProps) {
  const [state, dispatch] = useFormState(recordDeposit, initialState);
  const [currency, setCurrency] = useState('TOMAN');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState<Date>(new Date());

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      setCurrency('TOMAN');
      setAccountId('');
      setCategory('');
      setDate(new Date());
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>ثبت واریز</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">بابت چی؟ *</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="توضیح واریز را بنویسید..."
              rows={2}
              required
            />
            {errors?.description && (
              <p className="text-red-500 text-sm">{errors.description[0]}</p>
            )}
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-3">
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
              {errors?.amount && (
                <p className="text-red-500 text-sm">{errors.amount[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>ارز *</Label>
              <Select name="currency" value={currency} onValueChange={setCurrency} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب ارز" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors?.currency && (
                <p className="text-red-500 text-sm">{errors.currency[0]}</p>
              )}
            </div>
          </div>

          {/* Account */}
          <div className="space-y-2">
            <Label>حساب مقصد *</Label>
            <Select name="accountId" value={accountId} onValueChange={setAccountId} required>
              <SelectTrigger>
                <SelectValue placeholder="کدام حساب واریز شد؟" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors?.accountId && (
              <p className="text-red-500 text-sm">{errors.accountId[0]}</p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>دسته‌بندی</Label>
            <Select name="category" value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="دسته‌بندی (اختیاری)" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <TagInput name="tags" label="تگ‌ها" placeholder="مثال: ماهانه، پروژه‌الف..." />

          {/* Date */}
          <JalaliDatePicker
            name="date"
            label="تاریخ واریز"
            defaultValue={date}
            onChange={(d) => d && setDate(d)}
          />
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
    <Button type="submit" disabled={pending} className="bg-green-600 hover:bg-green-700">
      {pending ? 'در حال ثبت...' : 'ثبت واریز'}
    </Button>
  );
}
