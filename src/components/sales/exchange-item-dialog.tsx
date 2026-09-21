'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { exchangeOrderItem } from '@/actions/order-exchange';
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
import { toast } from 'sonner';
import { getProducts } from '@/actions/product';
import { getOrderMoney } from '@/actions/order-return';
import { accountLabel } from '@/lib/account-label';
import { exchangeChange, lineValue, receivableNow, type OrderMoney } from '@/lib/return-math';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface ExchangeItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  originalItem: {
    id: string;
    product: {
      id: string;
      name: string;
      sku: string;
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

export function ExchangeItemDialog({
  open,
  onOpenChange,
  orderId,
  originalItem,
  accounts,
  warehouses,
  onSuccess,
}: ExchangeItemDialogProps) {
  const [state, dispatch] = useFormState(exchangeOrderItem, initialState);
  const [quantity, setQuantity] = useState<string>('1');
  const [accountId, setAccountId] = useState<string>('');
  const [exchangeProductId, setExchangeProductId] = useState<string>('');
  const [returnWarehouseId, setReturnWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [exchangeWarehouseId, setExchangeWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [products, setProducts] = useState<Array<{ id: string; name: string; sellPrice: number }>>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [money, setMoney] = useState<(OrderMoney & { saleAccountId: string | null }) | null>(null);
  const [receivedNow, setReceivedNow] = useState<string>('');
  const [refundChoice, setRefundChoice] = useState<'' | 'refund' | 'credit'>('');
  const [requestId, renewRequestId] = useRequestId();

  // The order's current money, so the cash below is the one the server will book.
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

  useEffect(() => {
    if (open) {
      setLoadingProducts(true);
      getProducts()
        .then((prods) => {
          setProducts(prods.filter((p: any) => p.id !== originalItem.product.id));
        })
        .catch(() => {
          toast.error('خطا در بارگذاری محصولات');
        })
        .finally(() => {
          setLoadingProducts(false);
        });
    }
  }, [open, originalItem.product.id]);

  const selectedProduct = products.find((p) => p.id === exchangeProductId);
  // Same arithmetic as the server (src/lib/return-math.ts).
  const commission = { commissionRate: money?.commissionRate ?? 0 };
  const originalPrice = lineValue(commission, Number(originalItem.price), Number(quantity) || 0);
  const exchangePrice = selectedProduct
    ? lineValue(commission, Number(selectedProduct.sellPrice), Number(quantity) || 0)
    : 0;
  const priceDifference = exchangePrice - originalPrice;
  // Of a pricier swap, what the customer still owes after it (a credit on the order pays first).
  const receivable = money ? receivableNow(money, priceDifference) : 0;
  const received = receivable > 0 ? Number(receivedNow) || 0 : 0;
  const receivedTooMuch = receivable > 0 && (received < 0 || received > receivable + 0.01);
  // What could go back to the customer, before the cashier decides.
  const refundDue = money && priceDifference < 0 ? exchangeChange(money, priceDifference, { refundNow: true }).cashOut : 0;
  const change = money && selectedProduct
    ? exchangeChange(money, priceDifference, { receivedNow: received, refundNow: refundChoice === 'refund' })
    : null;
  const cashIn = change?.cashIn ?? 0;
  const cashOut = change?.cashOut ?? 0;
  // The server needs an account on every exchange; with no cash moving, none is shown or charged.
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
        setExchangeProductId('');
        setReceivedNow('');
        setRefundChoice('');
        setReturnWarehouseId(warehouses[0]?.id || '');
        setExchangeWarehouseId(warehouses[0]?.id || '');
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
          <DialogTitle>تعویض کالا</DialogTitle>
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
          <input type="hidden" name="originalItemId" value={originalItem.id} />
          <input type="hidden" name="returnWarehouseId" value={returnWarehouseId} />
          <input type="hidden" name="exchangeWarehouseId" value={exchangeWarehouseId} />
          <input type="hidden" name="receivedNow" value={priceDifference > 0 ? String(received) : ''} />
          <input type="hidden" name="refundNow" value={refundChoice === 'refund' ? '1' : '0'} />
          <input type="hidden" name="expectedCash" value={String(cashIn || cashOut)} />
          <RequestIdField value={requestId} />
          {cashIn + cashOut <= 0 && <input type="hidden" name="accountId" value={postedAccountId} />}

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>کالای فعلی</Label>
              <Input value={originalItem.product.name} disabled />
              <p className="text-xs text-muted-foreground">
                کد: {originalItem.product.sku} - قیمت: {Number(originalItem.price).toLocaleString('fa-IR')} تومان
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exchangeProductId">کالای تعویضی *</Label>
              <Select
                name="exchangeProductId"
                required
                value={exchangeProductId}
                onValueChange={setExchangeProductId}
                disabled={loadingProducts}
              >
                <SelectTrigger id="exchangeProductId">
                  <SelectValue placeholder={loadingProducts ? 'در حال بارگذاری...' : 'انتخاب کالا'} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} - {Number(product.sellPrice).toLocaleString('fa-IR')} تومان
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(state.errors as Record<string, string[] | undefined> | undefined)?.exchangeProductId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.exchangeProductId?.[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">تعداد (باقی‌مانده: {originalItem.remainingQuantity})</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={originalItem.remainingQuantity}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.quantity && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.quantity?.[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="returnWarehouseId">انبار برگشت کالای پس‌داده‌شده *</Label>
              <Select name="returnWarehouseId" required value={returnWarehouseId} onValueChange={setReturnWarehouseId}>
                <SelectTrigger id="returnWarehouseId">
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.returnWarehouseId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.returnWarehouseId?.[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="exchangeWarehouseId">انبار تحویل کالای جدید *</Label>
              <Select name="exchangeWarehouseId" required value={exchangeWarehouseId} onValueChange={setExchangeWarehouseId}>
                <SelectTrigger id="exchangeWarehouseId">
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.exchangeWarehouseId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.exchangeWarehouseId?.[0]}</p>
              )}
            </div>

            {selectedProduct && money && receivable > 0 && (
              <div className="space-y-2">
                <Label htmlFor="receivedNow">مبلغ دریافتی همین حالا (تومان)</Label>
                <Input
                  id="receivedNow"
                  type="number"
                  min="0"
                  max={receivable}
                  placeholder="۰"
                  value={receivedNow}
                  onChange={(e) => setReceivedNow(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  آنچه اکنون دریافت نشود به بدهی مشتری روی این سفارش اضافه می‌شود.
                </p>
                {receivedTooMuch && (
                  <p className="text-red-500 text-sm">
                    مبلغ دریافتی نمی‌تواند بیشتر از {receivable.toLocaleString('fa-IR')} تومان باشد.
                  </p>
                )}
              </div>
            )}

            {selectedProduct && money && refundDue > 0 && (
              <div className="space-y-2">
                <Label htmlFor="refundChoice">مبلغی که مشتری بیشتر پرداخته *</Label>
                <Select value={refundChoice} onValueChange={(value) => setRefundChoice(value as 'refund' | 'credit')}>
                  <SelectTrigger id="refundChoice">
                    <SelectValue placeholder="انتخاب کنید" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="refund">
                      همین حالا {refundDue.toLocaleString('fa-IR')} تومان نقدی پس داده می‌شود
                    </SelectItem>
                    <SelectItem value="credit">پس داده نمی‌شود؛ اعتبار مشتری روی همین سفارش می‌ماند</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {cashIn + cashOut > 0 && (
              <div className="space-y-2">
                <Label htmlFor="accountId">{cashIn > 0 ? 'حساب دریافت وجه *' : 'حساب پرداخت به مشتری *'}</Label>
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

            {selectedProduct && (
              <div className="p-3 bg-muted rounded-md space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">قیمت کالای فعلی:</span>
                  <span className="text-sm font-medium">
                    {originalPrice.toLocaleString('fa-IR')} تومان
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">قیمت کالای تعویضی:</span>
                  <span className="text-sm font-medium">
                    {exchangePrice.toLocaleString('fa-IR')} تومان
                  </span>
                </div>
                <div className="flex justify-between items-center border-t pt-2">
                  <span className="text-sm font-medium">
                    {priceDifference > 0 ? 'مبلغ اضافی:' : 'مابه‌التفاوت به نفع مشتری:'}
                  </span>
                  <span
                    className={`text-lg font-bold ${
                      priceDifference > 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {Math.abs(priceDifference).toLocaleString('fa-IR')} تومان
                  </span>
                </div>
                {money && money.commissionRate > 0 && (
                  <p className="text-xs text-muted-foreground text-right">مبالغ پس از کسر کمیسیون همکار</p>
                )}
                <div className="flex justify-between items-center border-t pt-2">
                  <span className="text-sm font-medium">
                    {cashIn > 0 ? 'دریافت نقدی از مشتری:' : cashOut > 0 ? 'پرداخت نقدی به مشتری:' : 'جابه‌جایی نقدی:'}
                  </span>
                  <span className="text-lg font-bold">
                    {!money ? '...' : `${(cashIn || cashOut).toLocaleString('fa-IR')} تومان`}
                  </span>
                </div>
                {money && priceDifference - receivable > 0.01 && (
                  <p className="text-xs text-muted-foreground text-right">
                    {(priceDifference - receivable).toLocaleString('fa-IR')} تومان از اعتبار مشتری روی این سفارش برداشته می‌شود
                  </p>
                )}
                {money && receivable - received > 0.01 && (
                  <p className="text-xs text-muted-foreground text-right">
                    {(receivable - received).toLocaleString('fa-IR')} تومان به بدهی مشتری اضافه می‌شود
                  </p>
                )}
                {money && priceDifference < 0 && refundDue <= 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    پولی جابه‌جا نمی‌شود؛ مابه‌التفاوت از بدهی مشتری روی این سفارش کم می‌شود
                  </p>
                )}
              </div>
            )}

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
            <SubmitButton
              disabled={!selectedProduct || !money || receivedTooMuch || (refundDue > 0 && !refundChoice)}
            />
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
      {pending ? 'در حال ثبت...' : 'ثبت تعویض'}
    </Button>
  );
}
