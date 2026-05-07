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
  const originalPrice = (Number(quantity) || 0) * Number(originalItem.price);
  const exchangePrice = selectedProduct
    ? (Number(quantity) || 0) * Number(selectedProduct.sellPrice)
    : 0;
  const priceDifference = exchangePrice - originalPrice;
  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    // Only process if message has changed
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      
      if (state.success) {
        toast.success(state.message);
        setQuantity('1');
        setAccountId('');
        setExchangeProductId('');
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

            <div className="space-y-2">
              <Label htmlFor="accountId">حساب *</Label>
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0]}</p>
              )}
            </div>

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
                    {priceDifference > 0 ? 'مبلغ اضافی:' : 'مبلغ قابل بازگشت:'}
                  </span>
                  <span
                    className={`text-lg font-bold ${
                      priceDifference > 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {Math.abs(priceDifference).toLocaleString('fa-IR')} تومان
                  </span>
                </div>
                {priceDifference > 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    مشتری باید مابه‌التفاوت را بپردازد
                  </p>
                )}
                {priceDifference < 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    مابه‌التفاوت به مشتری بازگردانده می‌شود
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
            <SubmitButton disabled={!selectedProduct} />
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
