'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { returnOrderItem } from '@/actions/order-return';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface ReturnItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderItem: {
    id: string;
    product: {
      id: string;
      name: string;
    };
    quantity: number;
    price: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
  }>;
  onSuccess?: () => void;
}

export function ReturnItemDialog({
  open,
  onOpenChange,
  orderId,
  orderItem,
  accounts,
  onSuccess,
}: ReturnItemDialogProps) {
  const [state, dispatch] = useFormState(returnOrderItem, initialState);
  const [quantity, setQuantity] = useState<string>('1');
  const [accountId, setAccountId] = useState<string>('');

  const refundAmount = (Number(quantity) || 0) * Number(orderItem.price);
  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    // Only process if message has changed
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      
      if (state.success) {
        toast.success(state.message);
        setQuantity('1');
        setAccountId('');
        onOpenChange(false);
        if (onSuccess) {
          onSuccess();
        }
      } else {
        toast.error(state.message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>عودت کالا</DialogTitle>
        </DialogHeader>
        <form
          action={dispatch}
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            dispatch(formData);
          }}
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItem.id} />

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>کالا</Label>
              <Input value={orderItem.product.name} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">تعداد (حداکثر: {orderItem.quantity})</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={orderItem.quantity}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
              {state.errors?.quantity && (
                <p className="text-red-500 text-sm">{state.errors.quantity[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountId">حساب برای بازگرداندن پول *</Label>
              <Select name="accountId" required value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="accountId">
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
              {state.errors?.accountId && (
                <p className="text-red-500 text-sm">{state.errors.accountId[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">علت عودت (اختیاری)</Label>
              <Textarea
                id="reason"
                name="reason"
                placeholder="علت عودت کالا..."
                rows={3}
              />
            </div>

            <div className="p-3 bg-muted rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">مبلغ بازگشتی:</span>
                <span className="text-lg font-bold text-green-600">
                  {refundAmount.toLocaleString('fa-IR')} تومان
                </span>
              </div>
            </div>

            {state.message && !state.success && (
              <div className="text-sm p-2 rounded bg-red-100 text-red-700">
                {state.message}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
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
      {pending ? 'در حال ثبت...' : 'ثبت عودت'}
    </Button>
  );
}
