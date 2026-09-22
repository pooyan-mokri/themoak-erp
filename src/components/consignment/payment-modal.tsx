'use client';

import { useState, useTransition } from 'react';
import { paySettlement } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';
import { accountLabel } from '@/lib/account-label';
import { useRequestId } from '@/components/ui/request-id';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';

interface Account {
  id: string;
  name: string;
  currency: string;
  type?: string;
  cardNumber?: string | null;
}

interface PaymentModalProps {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  accounts: Account[];
}

export function PaymentModal({
  orderId,
  totalAmount,
  paidAmount,
  remainingAmount,
  accounts,
}: PaymentModalProps) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(remainingAmount.toString());
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [receiptUrl, setReceiptUrl] = useState('');
  const [isPending, startTransition] = useTransition();
  const [requestId, renewRequestId] = useRequestId();
  // A settlement is real money: only a bank or cash account can receive it.
  const cashAccounts = accounts.filter((a) => a.type === 'BANK' || a.type === 'CASH');
  const chosen = cashAccounts.find((a) => a.id === accountId);

  const handleSubmit = () => {
    if (!accountId) {
      toast.error('لطفاً حساب مقصد را انتخاب کنید');
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error('مبلغ پرداخت نامعتبر است');
      return;
    }
    if (amt > remainingAmount + 0.01) {
      toast.error('مبلغ بیشتر از باقیمانده است');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('orderId', orderId);
      fd.set('accountId', accountId);
      fd.set('amount', String(amt));
      fd.set('paymentDate', paymentDate.toISOString().slice(0, 10));
      fd.set('requestId', requestId);
      fd.set('receiptUrl', receiptUrl);
      const result = await paySettlement(undefined as any, fd);
      if (result.success) {
        toast.success(result.message);
        renewRequestId();
        setReceiptUrl('');
        setOpen(false);
      } else {
        toast.error(result.message || 'خطا در ثبت پرداخت');
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Pre-fill what is owed now, not what was owed when the page first loaded.
        if (next) setAmount(remainingAmount.toString());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          ثبت پرداخت
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>ثبت پرداخت تسویه</DialogTitle>
          <DialogDescription>
            می‌توانید کل یا بخشی از مبلغ باقیمانده را ثبت کنید.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="grid grid-cols-3 gap-2 p-3 rounded bg-muted/40">
            <div>
              <div className="text-muted-foreground text-xs">کل فاکتور</div>
              <div className="font-medium">{totalAmount.toLocaleString('fa-IR')}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">پرداخت شده</div>
              <div className="font-medium text-green-700">
                {paidAmount.toLocaleString('fa-IR')}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">باقیمانده</div>
              <div className="font-bold text-orange-600">
                {remainingAmount.toLocaleString('fa-IR')}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>مبلغ پرداخت (تومان)</Label>
            <Input
              type="number"
              min="0"
              max={remainingAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(remainingAmount.toString())}
              >
                کل باقیمانده
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(String(Math.round(remainingAmount / 2)))}
              >
                نصف
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>حساب مقصد</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب حساب" />
              </SelectTrigger>
              <SelectContent>
                {cashAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen && chosen.currency !== 'TOMAN' && (
              <p className="text-xs text-muted-foreground">
                مبلغ به تومان است و با آخرین نرخ ثبت‌شده به {chosen.currency} تبدیل می‌شود.
              </p>
            )}
          </div>

          <JalaliDatePicker
            name="paymentDate"
            label="تاریخ پرداخت"
            defaultValue={paymentDate}
            onChange={(d) => d && setPaymentDate(d)}
          />

          <div className="space-y-2">
            <Label>رسید پرداخت (اختیاری)</Label>
            <ReceiptUpload
              currentUrl={receiptUrl}
              onUploadComplete={(url) => setReceiptUrl(url)}
              onRemove={() => setReceiptUrl('')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'در حال ثبت...' : 'تایید پرداخت'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
