'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { recordInternalTransfer } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { TagInput } from '@/components/ui/tag-input';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const initialState = { message: '', errors: {}, success: false };

interface Account {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

export function TransferForm({ accounts }: { accounts: Account[] }) {
  const [state, dispatch] = useFormState(recordInternalTransfer, initialState);
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      setFromAccountId('');
      setToAccountId('');
      setDate(new Date());
      setReceiptUrl('');
      setReceiptType('');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const currencyMismatch = fromAccount && toAccount && fromAccount.currency !== toAccount.currency;

  // Filter destination to same currency as source
  const eligibleTargets = fromAccountId
    ? accounts.filter((a) => a.id !== fromAccountId && a.currency === fromAccount?.currency)
    : accounts.filter((a) => a.id !== fromAccountId);

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>انتقال وجه بین حساب‌ها</CardTitle>
        <CardDescription>فقط بین حساب‌هایی با ارز یکسان امکان‌پذیر است</CardDescription>
      </CardHeader>
      <form action={dispatch}>
        <input type="hidden" name="receiptUrl" value={receiptUrl} />

        <CardContent className="space-y-4">
          {/* From Account */}
          <div className="space-y-2">
            <Label>حساب مبدأ *</Label>
            <Select name="fromAccountId" value={fromAccountId} onValueChange={(v) => { setFromAccountId(v); setToAccountId(''); }} required>
              <SelectTrigger><SelectValue placeholder="از کدام حساب..." /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency}) — {a.balance.toLocaleString('fa-IR')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors?.fromAccountId && <p className="text-red-500 text-sm">{errors.fromAccountId[0]}</p>}
          </div>

          {/* Arrow */}
          {fromAccountId && (
            <div className="flex justify-center text-muted-foreground">
              <ArrowLeft className="h-5 w-5" />
            </div>
          )}

          {/* To Account */}
          <div className="space-y-2">
            <Label>حساب مقصد *</Label>
            <Select name="toAccountId" value={toAccountId} onValueChange={setToAccountId} required disabled={!fromAccountId}>
              <SelectTrigger>
                <SelectValue placeholder={fromAccountId ? `فقط حساب‌های ${fromAccount?.currency}` : 'ابتدا حساب مبدأ را انتخاب کنید'} />
              </SelectTrigger>
              <SelectContent>
                {eligibleTargets.length === 0 ? (
                  <SelectItem value="none" disabled>حساب دیگری با این ارز وجود ندارد</SelectItem>
                ) : (
                  eligibleTargets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.currency}) — {a.balance.toLocaleString('fa-IR')}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors?.toAccountId && <p className="text-red-500 text-sm">{errors.toAccountId[0]}</p>}
          </div>

          {currencyMismatch && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              ارز دو حساب یکسان نیست. برای تبدیل ارز از بخش «خرید و فروش ارز» استفاده کنید.
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              مبلغ {fromAccount ? `(${fromAccount.currency})` : ''} *
            </Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0" placeholder="0" required />
            {fromAccount && (
              <p className="text-xs text-muted-foreground">موجودی: {fromAccount.balance.toLocaleString('fa-IR')} {fromAccount.currency}</p>
            )}
            {errors?.amount && <p className="text-red-500 text-sm">{errors.amount[0]}</p>}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">توضیحات</Label>
            <Textarea id="description" name="description" placeholder="شرح انتقال (اختیاری)..." rows={2} />
          </div>

          {/* Tags */}
          <TagInput name="tags" label="تگ‌ها" placeholder="مثال: انتقال‌ماهانه..." />

          {/* Date */}
          <JalaliDatePicker name="date" label="تاریخ انتقال" defaultValue={date} onChange={(d) => d && setDate(d)} />

          {/* Receipt */}
          <div className="space-y-2">
            <Label>سند / رسید انتقال (اختیاری)</Label>
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
    <Button type="submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700">
      {pending ? 'در حال انتقال...' : 'ثبت انتقال'}
    </Button>
  );
}
