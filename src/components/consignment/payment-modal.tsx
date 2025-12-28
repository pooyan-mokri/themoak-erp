
'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
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
import { Label } from '@/components/ui/label';

interface PaymentModalProps {
  orderId: string;
  amount: number;
  accounts: any[];
}

export function PaymentModal({ orderId, amount, accounts }: PaymentModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          ثبت پرداخت
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>ثبت پرداخت تسویه حساب</DialogTitle>
          <DialogDescription>
            مبلغ {amount.toLocaleString()} تومان به کدام حساب واریز شد؟
          </DialogDescription>
        </DialogHeader>
        <form
          action={async (formData) => {
            await paySettlement(undefined, formData);
            setOpen(false);
          }}
        >
          <input type="hidden" name="orderId" value={orderId} />
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="accountId" className="text-right">
                حساب مقصد
              </Label>
              <Select name="accountId" required>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'تایید پرداخت'}
    </Button>
  );
}
