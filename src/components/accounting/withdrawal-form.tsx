'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordWithdrawal } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { TagInput } from '@/components/ui/tag-input';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';
import { toast } from 'sonner';

const initialState = { message: '', errors: {}, success: false };

const CURRENCIES = [
  { value: 'TOMAN', label: 'تومان' },
  { value: 'USD', label: 'دلار (USD)' },
  { value: 'EUR', label: 'یورو (EUR)' },
  { value: 'CNY', label: 'یوان (CNY)' },
];

const CATEGORIES = [
  'پرداخت اجاره',
  'پرداخت قبض',
  'خرید تجهیزات',
  'هزینه حمل‌ونقل',
  'پرداخت به تامین‌کننده',
  'پرداخت به پیمانکار',
  'سایر هزینه‌ها',
];

interface Account {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

export function WithdrawalForm({ accounts }: { accounts: Account[] }) {
  const [state, dispatch] = useFormState(recordWithdrawal, initialState);
  const [currency, setCurrency] = useState('TOMAN');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      setCurrency('TOMAN');
      setAccountId('');
      setCategory('');
      setDate(new Date());
      setReceiptUrl('');
      setReceiptType('');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const selectedAccount = accounts.find((a) => a.id === accountId);

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>ثبت پرداخت / برداشت</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <input type="hidden" name="receiptUrl" value={receiptUrl} />

        <CardContent className="space-y-4">
          {/* Payee */}
          <div className="space-y-2">
            <Label htmlFor="payee">گیرنده (به چه کسی؟) *</Label>
            <Input id="payee" name="payee" placeholder="نام شخص، شرکت یا نهاد گیرنده..." required />
            {errors?.payee && <p className="text-red-500 text-sm">{errors.payee[0]}</p>}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">بابت چی؟</Label>
            <Textarea id="description" name="description" placeholder="شرح پرداخت..." rows={2} />
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amount">مبلغ *</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0" placeholder="0" required />
              {errors?.amount && <p className="text-red-500 text-sm">{errors.amount[0]}</p>}
            </div>
            <div className="space-y-2">
              <Label>ارز *</Label>
              <Select name="currency" value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Account */}
          <div className="space-y-2">
            <Label>حساب مبدأ *</Label>
            <Select name="accountId" value={accountId} onValueChange={setAccountId} required>
              <SelectTrigger><SelectValue placeholder="از کدام حساب برداشت شود؟" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency}) — موجودی: {a.balance.toLocaleString('fa-IR')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors?.accountId && <p className="text-red-500 text-sm">{errors.accountId[0]}</p>}
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>دسته‌بندی</Label>
            <Select name="category" value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="دسته‌بندی (اختیاری)" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <TagInput name="tags" label="تگ‌ها" placeholder="مثال: هزینه‌ثابت، اورژانسی..." />

          {/* Date */}
          <JalaliDatePicker name="date" label="تاریخ پرداخت" defaultValue={date} onChange={(d) => d && setDate(d)} />

          {/* Receipt */}
          <div className="space-y-2">
            <Label>سند / رسید (اختیاری)</Label>
            <ReceiptUpload
              onUploadComplete={(url, type) => { setReceiptUrl(url); setReceiptType(type); }}
              onRemove={() => { setReceiptUrl(''); setReceiptType(''); }}
              currentUrl={receiptUrl}
              currentType={receiptType}
            />
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
    <Button type="submit" disabled={pending} variant="destructive">
      {pending ? 'در حال ثبت...' : 'ثبت پرداخت'}
    </Button>
  );
}
