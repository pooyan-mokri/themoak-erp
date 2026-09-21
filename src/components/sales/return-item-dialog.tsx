'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { getOrderMoney, returnOrderItem } from '@/actions/order-return';
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
import { accountLabel } from '@/lib/account-label';
import { lineValue, returnChange, type OrderMoney } from '@/lib/return-math';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';

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
    remainingQuantity: number;
    price: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    cardNumber?: string | null;
  }>;
  warehouses: Array<{
    id: string;
    name: string;
  }>;
  onSuccess?: () => void;
}

export function ReturnItemDialog({
  open,
  onOpenChange,
  orderId,
  orderItem,
  accounts,
  warehouses,
  onSuccess,
}: ReturnItemDialogProps) {
  const [state, dispatch] = useFormState(returnOrderItem, initialState);
  const [quantity, setQuantity] = useState<string>('1');
  const [accountId, setAccountId] = useState<string>('');
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [money, setMoney] = useState<(OrderMoney & { saleAccountId: string | null }) | null>(null);
  const [requestId, renewRequestId] = useRequestId();

  // The order's current money, so the refund below is the one the server will book.
  useEffect(() => {
    if (!open) return;
    setMoney(null);
    getOrderMoney(orderId)
      .then((loaded) => {
        setMoney(loaded);
        const saleAccountId = loaded?.saleAccountId;
        if (saleAccountId && accounts.some((account) => account.id === saleAccountId)) {
          setAccountId((current) => current || saleAccountId);
        }
      })
      .catch(() => toast.error('خطا در بارگذاری مبالغ سفارش'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  // Same arithmetic as the server (src/lib/return-math.ts).
  const refundAmount = money ? lineValue(money, Number(orderItem.price), Number(quantity) || 0) : 0;
  const cashRefund = money ? returnChange(money, refundAmount).cashOut : 0;
  // The server needs an account on every return; with no cash moving, none is shown or charged.
  const postedAccountId = accountId || money?.saleAccountId || accounts[0]?.id || '';
  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    // Only process if message has changed
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      
      if (state.success) {
        toast.success(state.message);
        renewRequestId();
        setQuantity('1');
        setAccountId('');
        setWarehouseId(warehouses[0]?.id || '');
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
          <input type="hidden" name="warehouseId" value={warehouseId} />
          <input type="hidden" name="expectedCash" value={String(cashRefund)} />
          <RequestIdField value={requestId} />
          {cashRefund <= 0 && <input type="hidden" name="accountId" value={postedAccountId} />}

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>کالا</Label>
              <Input value={orderItem.product.name} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">تعداد (باقی‌مانده: {orderItem.remainingQuantity})</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={orderItem.remainingQuantity}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.quantity && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.quantity?.[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="warehouseId">انبار برگشت کالا *</Label>
              <Select name="warehouseId" required value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger id="warehouseId">
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(state.errors as Record<string, string[] | undefined> | undefined)?.warehouseId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.warehouseId?.[0]}</p>
              )}
            </div>

            {cashRefund > 0 && (
              <div className="space-y-2">
                <Label htmlFor="accountId">حساب برای بازگرداندن پول *</Label>
                <Select name="accountId" required value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="accountId">
                    <SelectValue placeholder="انتخاب حساب" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {accountLabel(account)}
                        {account.id === money?.saleAccountId ? ' — حساب دریافت این فروش' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
                  <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0]}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reason">علت عودت (اختیاری)</Label>
              <Textarea
                id="reason"
                name="reason"
                placeholder="علت عودت کالا..."
                rows={3}
              />
            </div>

            <div className="p-3 bg-muted rounded-md space-y-2">
              {!money ? (
                <p className="text-sm text-muted-foreground">در حال محاسبهٔ مبلغ...</p>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">
                      ارزش کالای برگشتی{money.commissionRate > 0 ? ' (پس از کسر کمیسیون همکار)' : ''}:
                    </span>
                    <span className="text-sm font-medium">{refundAmount.toLocaleString('fa-IR')} تومان</span>
                  </div>
                  <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-sm font-medium">پرداخت نقدی به مشتری:</span>
                    <span className="text-lg font-bold text-green-600">
                      {cashRefund.toLocaleString('fa-IR')} تومان
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {cashRefund > 0
                      ? 'این مبلغ از حساب انتخاب‌شده به مشتری برگردانده می‌شود؛ بقیه از بدهی مشتری کم می‌شود.'
                      : 'پولی جابه‌جا نمی‌شود؛ ارزش کالا از بدهی مشتری روی این سفارش کم می‌شود.'}
                  </p>
                </>
              )}
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
            <SubmitButton disabled={!money} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'در حال ثبت...' : 'ثبت عودت'}
    </Button>
  );
}
