'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createMarketingGift } from '@/actions/marketing';
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useState, useEffect } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';

const initialState: {
  message: string;
  errors: Record<string, string[]>;
} = {
  message: '',
  errors: {},
};

interface GiftFormProps {
  products: Array<{
    id: string;
    name: string;
    sku: string;
    costPrice: number;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
  }>;
  campaigns?: Array<{
    id: string;
    name: string;
  }>;
  warehouses: Array<{
    id: string;
    name: string;
  }>;
}

interface CartItem {
  productId: string;
  quantity: number;
  warehouseId: string;
}

export function GiftForm({ products, accounts, campaigns = [], warehouses }: GiftFormProps) {
  const [state, dispatch] = useFormState(createMarketingGift, initialState);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [date, setDate] = useState<string>('');

  const addToCart = () => {
    if (!selectedProductId || !selectedWarehouseId || !quantity || Number(quantity) <= 0) {
      return;
    }

    const existingItem = cart.find(
      item => item.productId === selectedProductId && item.warehouseId === selectedWarehouseId
    );

    if (existingItem) {
      setCart(cart.map(item =>
        item.productId === selectedProductId && item.warehouseId === selectedWarehouseId
          ? { ...item, quantity: item.quantity + Number(quantity) }
          : item
      ));
    } else {
      setCart([...cart, {
        productId: selectedProductId,
        quantity: Number(quantity),
        warehouseId: selectedWarehouseId,
      }]);
    }

    // Reset selection
    setSelectedProductId('');
    setSelectedWarehouseId('');
    setQuantity('1');
  };

  const removeFromCart = (productId: string, warehouseId: string) => {
    setCart(cart.filter(item => !(item.productId === productId && item.warehouseId === warehouseId)));
  };

  const updateQuantity = (productId: string, warehouseId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.productId === productId && item.warehouseId === warehouseId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  // Calculate total cost
  const totalCost = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.productId);
    if (product) {
      return sum + (Number(product.costPrice) * item.quantity);
    }
    return sum;
  }, 0);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const handleSubmit = async (formData: FormData) => {
    if (cart.length === 0) {
      return;
    }

    // Add items as JSON string
    formData.append('items', JSON.stringify(cart));
    
    dispatch(formData);
  };

  // Clear cart on success
  useEffect(() => {
    if (state.message && Object.keys(state.errors || {}).length === 0) {
      setCart([]);
      setSelectedProductId('');
      setSelectedWarehouseId('');
      setQuantity('1');
    }
  }, [state.message, state.errors]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت هدیه بازاریابی</CardTitle>
      </CardHeader>
      <form action={handleSubmit}>
        <CardContent className="space-y-5 md:space-y-4">
          {/* Add Product Section */}
          <div className="border rounded-lg p-4 md:p-4 bg-gray-50">
            <h3 className="font-semibold mb-4 text-base md:text-sm">افزودن محصول</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-4">
              <div className="space-y-2">
                <Label htmlFor="productId" className="text-base md:text-sm">محصول</Label>
                <Select
                  value={selectedProductId}
                  onValueChange={setSelectedProductId}
                >
                  <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                    <SelectValue placeholder="انتخاب محصول" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProduct && (
                  <p className="text-xs text-muted-foreground">
                    قیمت تمام شده: {new Intl.NumberFormat('fa-IR').format(Number(selectedProduct.costPrice))} تومان
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="warehouseId" className="text-base md:text-sm">انبار</Label>
                <Select
                  value={selectedWarehouseId}
                  onValueChange={setSelectedWarehouseId}
                >
                  <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                    <SelectValue placeholder="انتخاب انبار" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity" className="text-base md:text-sm">تعداد</Label>
                <div className="flex gap-2">
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="1"
                    className="flex-1 h-12 md:h-10 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    onClick={addToCart}
                    disabled={!selectedProductId || !selectedWarehouseId || !quantity}
                    className="h-12 md:h-10 px-6 md:px-4 text-base md:text-sm font-semibold"
                  >
                    افزودن
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Cart Items */}
          {cart.length > 0 && (
            <div className="border rounded-lg p-4 md:p-4">
              <h3 className="font-semibold mb-4 text-base md:text-sm">لیست محصولات ({cart.length})</h3>
              <div className="space-y-3 md:space-y-2 max-h-60 overflow-y-auto">
                {cart.map((item, index) => {
                  const product = products.find(p => p.id === item.productId);
                  const warehouse = warehouses.find(w => w.id === item.warehouseId);
                  const itemCost = product ? Number(product.costPrice) * item.quantity : 0;
                  
                  return (
                    <div key={`${item.productId}-${item.warehouseId}`} className="flex items-center justify-between bg-white p-3 md:p-3 rounded-lg border gap-3 md:gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-base md:text-sm truncate">{product?.name || 'نامشخص'}</div>
                        <div className="text-sm md:text-xs text-muted-foreground mt-1">
                          {warehouse?.name} - {item.quantity} عدد - {new Intl.NumberFormat('fa-IR').format(itemCost)} تومان
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 md:h-8 md:w-8 touch-manipulation"
                          onClick={() => updateQuantity(item.productId, item.warehouseId, -1)}
                        >
                          <Minus className="h-4 w-4 md:h-3 md:w-3" />
                        </Button>
                        <span className="w-10 md:w-8 text-center text-base md:text-sm font-bold">{item.quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 md:h-8 md:w-8 touch-manipulation"
                          onClick={() => updateQuantity(item.productId, item.warehouseId, 1)}
                        >
                          <Plus className="h-4 w-4 md:h-3 md:w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 md:h-8 md:w-8 text-red-500 hover:text-red-600 touch-manipulation"
                          onClick={() => removeFromCart(item.productId, item.warehouseId)}
                        >
                          <Trash2 className="h-5 w-5 md:h-4 md:w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-base md:text-sm">هزینه کل:</span>
                  <span className="font-bold text-xl md:text-lg text-red-600">
                    {new Intl.NumberFormat('fa-IR').format(totalCost)} تومان
                  </span>
                </div>
              </div>
            </div>
          )}

          {state.errors && 'items' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.items?.[0] && (
            <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.items[0]}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-4">
            {/* Recipient Name */}
            <div className="space-y-2">
              <Label htmlFor="recipientName" className="text-base md:text-sm">نام گیرنده *</Label>
              <Input
                id="recipientName"
                name="recipientName"
                placeholder="نام شخص یا سازمان"
                required
                className="h-12 md:h-10 text-base md:text-sm"
              />
              {state.errors && 'recipientName' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.recipientName?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.recipientName[0]}</p>
              )}
            </div>

            {/* Account */}
            <div className="space-y-2">
              <Label htmlFor="accountId" className="text-base md:text-sm">حساب برای ثبت هزینه *</Label>
              <Select 
                name="accountId" 
                required
                defaultValue={accounts.find(a => a.name === 'Marketing Expenses')?.id || ''}
              >
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
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
              {state.errors && 'accountId' in state.errors && (state.errors as Record<string, string[] | undefined> | undefined)?.accountId?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId[0]}</p>
              )}
            </div>

            {/* Campaign */}
            {campaigns.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="campaignId" className="text-base md:text-sm">کمپین بازاریابی (اختیاری)</Label>
                <Select name="campaignId">
                  <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                    <SelectValue placeholder="انتخاب کمپین (اختیاری)" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="date">تاریخ</Label>
              <JalaliDatePicker
                name="date"
                defaultValue={date ? new Date(date) : undefined}
                onChange={(selectedDate) => {
                  setDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="date" value={date} />
            </div>

            {/* Reason */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="reason" className="text-base md:text-sm">دلیل هدیه (اختیاری)</Label>
              <Input
                id="reason"
                name="reason"
                placeholder="مثال: وفاداری مشتری، تبلیغات، رویداد خاص"
                className="h-12 md:h-10 text-base md:text-sm"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes" className="text-base md:text-sm">توضیحات (اختیاری)</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="توضیحات اضافی..."
                rows={5}
                className="min-h-[120px] md:min-h-[100px] text-base md:text-sm"
              />
            </div>
          </div>

          {state.message && (
            <div
              className={`text-sm p-3 rounded ${
                Object.keys(state.errors || {}).length === 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end pt-4">
          <SubmitButton disabled={cart.length === 0} />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button 
      type="submit" 
      disabled={pending || disabled}
      className="h-14 md:h-10 w-full md:w-auto text-base md:text-sm font-semibold"
    >
      {pending ? 'در حال ثبت...' : 'ثبت هدیه'}
    </Button>
  );
}
