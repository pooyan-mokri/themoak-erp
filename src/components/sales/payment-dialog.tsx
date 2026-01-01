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
import { getAccounts } from '@/actions/accounting';

type OrderWithDetails = {
  id: string;
  number: number;
  totalAmount: number;
  discount?: number;
  paidAmount?: number;
  paymentStatus: string;
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

  const totalAmount = Number(order.totalAmount) - Number(order.discount || 0);
  const paidAmount = Number(order.paidAmount || 0);
  const remainingDebt = totalAmount - paidAmount;

  useEffect(() => {
    if (open) {
      // Load accounts
      getAccounts().then((data) => {
        const paymentAccounts = data.filter(
          (a: any) => a.type === 'BANK' || a.type === 'CASH'
        );
        setAccounts(paymentAccounts);
      });
      // Set default amount to full remaining debt
      setAmount(remainingDebt.toString());
      setSelectedAccount('');
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
      toast.error(`مبلغ پرداخت نمی‌تواند بیشتر از بدهی باقیمانده (${remainingDebt.toLocaleString()} تومان) باشد.`);
      return;
    }

    setIsSubmitting(true);
    const result = await recordOrderPayment(order.id, selectedAccount, paymentAmount);
    setIsSubmitting(false);

    if (result.success) {
      toast.success('پرداخت با موفقیت ثبت شد.');
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
              <span className="font-medium">{totalAmount.toLocaleString()} تومان</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">مبلغ پرداخت شده:</span>
              <span className="font-medium text-green-600">{paidAmount.toLocaleString()} تومان</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>بدهی باقیمانده:</span>
              <span className="text-red-600">{remainingDebt.toLocaleString()} تومان</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>حساب دریافت وجه *</Label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب صندوق/بانک" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
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
