'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { recordOrderPayment } from '@/actions/sales';
import { applyCustomerCredit, getCustomerCredit } from '@/actions/customer-credit';
import { getAccountOptions } from '@/actions/account-options';
import { accountLabel } from '@/lib/account-label';
import { orderNet } from '@/lib/order-balance';
import { creditUsable } from '@/lib/return-math';
import { useRequestId } from '@/components/ui/request-id';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';

type OrderWithDetails = {
  id: string;
  number: number;
  totalAmount: number;
  discount?: number;
  paidAmount?: number;
  paymentStatus: string;
  wooId?: number | null;
  siteReference?: string | null;
  customerId?: string;
  customer?: {
    name: string;
  };
};

interface PaymentDialogProps {
  order: OrderWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentDialog({ order, open, onOpenChange }: PaymentDialogProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [requestId, renewRequestId] = useRequestId();
  // The customer's credit account, which can pay the order without cash.
  const [creditBalance, setCreditBalance] = useState(0);
  const [creditRequestId, renewCreditRequestId] = useRequestId();

  // One dialog serves every order in the list: a payment to another order is another submission.
  useEffect(() => {
    renewRequestId();
    renewCreditRequestId();
  }, [order.id, renewRequestId, renewCreditRequestId]);

  // The same net as the server's payment check (src/lib/order-balance.ts).
  const totalAmount = orderNet(order);
  const paidAmount = Number(order.paidAmount || 0);
  const remainingDebt = totalAmount - paidAmount;
  const creditToUse = creditUsable(creditBalance, remainingDebt);

  useEffect(() => {
    setCreditBalance(0);
    if (open && order.customerId) {
      getCustomerCredit(order.customerId)
        .then(setCreditBalance)
        .catch(() => setCreditBalance(0));
    }
  }, [open, order.customerId]);

  useEffect(() => {
    if (open) {
      // Load accounts
      getAccountOptions().then((data) => {
        const paymentAccounts = data.filter(
          (a: any) => a.type === 'BANK' || a.type === 'CASH'
        );
        setAccounts(paymentAccounts);
      });
      // Set default amount to full remaining debt
      setAmount(remainingDebt.toString());
      setSelectedAccount('');
      setReceiptUrl('');
    }
  }, [open, remainingDebt]);

  const handleSubmit = async () => {
    if (!selectedAccount) {
      toast.error('لطفا حساب را انتخاب کنید.');
      return;
    }

    const paymentAmount = Number(amount);
    if (paymentAmount <= 0) {
      toast.error('مبلغ پرداخت باید بیشتر از صفر باشد.');
      return;
    }

    if (paymentAmount > remainingDebt) {
      toast.error(`مبلغ پرداخت نمی‌تواند بیشتر از بدهی باقیمانده (${remainingDebt.toLocaleString('fa-IR')} تومان) باشد.`);
      return;
    }

    setIsSubmitting(true);
    const result = await recordOrderPayment(order.id, selectedAccount, paymentAmount, requestId, receiptUrl || undefined);
    setIsSubmitting(false);

    if (result.success) {
      renewRequestId();
      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleUseCredit = async () => {
    setIsSubmitting(true);
    const result = await applyCustomerCredit(order.id, creditToUse, creditRequestId);
    setIsSubmitting(false);
    if (result.success) {
      renewCreditRequestId();
      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-right">ثبت پرداخت سفارش #{order.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">مشتری:</span>
              <span className="font-medium">{order.customer?.name || 'مشتری عمومی'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">مبلغ کل سفارش:</span>
              <span className="font-medium">{totalAmount.toLocaleString('fa-IR')} تومان</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">مبلغ پرداخت شده:</span>
              <span className="font-medium text-success">{paidAmount.toLocaleString('fa-IR')} تومان</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>بدهی باقیمانده:</span>
              <span className="text-danger">{remainingDebt.toLocaleString('fa-IR')} تومان</span>
            </div>
          </div>

          {creditToUse > 0 && (
            <div className="space-y-2 rounded-md border bg-success-soft p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">اعتبار مشتری:</span>
                <span className="font-medium text-success">{creditBalance.toLocaleString('fa-IR')} تومان</span>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={handleUseCredit} disabled={isSubmitting}>
                پرداخت {creditToUse.toLocaleString('fa-IR')} تومان از اعتبار مشتری
              </Button>
              <p className="text-xs text-muted-foreground">بدون دریافت وجه؛ از اعتبار مشتری کم می‌شود.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>حساب دریافت وجه *</Label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب صندوق/بانک" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>مبلغ پرداخت (تومان) *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="مبلغ پرداخت را وارد کنید"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(remainingDebt.toString())}
              >
                تسویه کامل
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount((remainingDebt / 2).toString())}
              >
                نصف مبلغ
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>رسید پرداخت (اختیاری)</Label>
            <ReceiptUpload
              currentUrl={receiptUrl}
              onUploadComplete={(url) => setReceiptUrl(url)}
              onRemove={() => setReceiptUrl('')}
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'در حال ثبت...' : 'ثبت پرداخت'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
