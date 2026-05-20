'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductGrid } from './product-grid';
import { CartSummary } from './cart-summary';
import { Button } from '@/components/ui/button';
import { createOrder } from '@/actions/sales';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { QuickCustomerForm } from './quick-customer-form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ShoppingCart } from 'lucide-react';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';

interface Product {
  id: string;
  name: string;
  sku: string;
  sellPrice: any;
  image?: string;
}

interface Customer {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
  cardNumber?: string;
  sheba?: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface POSInterfaceProps {
  products: Product[];
  customers: Customer[];
  accounts: Account[];
  warehouses: Warehouse[];
}

export function POSInterface({ products, customers: initialCustomers, accounts, warehouses }: POSInterfaceProps) {
  const router = useRouter();
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>(warehouses.length > 0 ? warehouses[0].id : '');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ACCOUNT'>('CASH');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [discount, setDiscount] = useState<string>('0');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [saleDate, setSaleDate] = useState<Date>(new Date());

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : item;
        }
        return item;
      })
    );
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + Number(item.product.sellPrice) * item.quantity,
    0
  );

  // Calculate final amount based on discount
  const finalAmount = totalAmount - (Number(discount) || 0);

  // Reset checkout state when opening dialog
  const openCheckout = () => {
    setDiscount('0');
    setPaidAmount(totalAmount.toString());
    setIsCreditSale(false);
    setSaleDate(new Date());
    setIsCheckoutOpen(true);
  };

  // Update paidAmount when discount changes
  const handleDiscountChange = (value: string) => {
    setDiscount(value);
    if (!isCreditSale) {
      const discountVal = Number(value) || 0;
      const newFinalAmount = totalAmount - discountVal;
      // Auto-update paidAmount to match the new final amount after discount
      // This ensures the paid amount reflects the discount
      setPaidAmount(newFinalAmount.toString());
    }
  };

  // Handle credit sale toggle
  const handleCreditSaleChange = (checked: boolean) => {
    setIsCreditSale(checked);
    if (checked) {
      // Credit sale: no payment now
      setPaidAmount('0');
    } else {
      // Regular sale: full payment
      setPaidAmount(finalAmount.toString());
    }
  };

  const handleCheckout = async () => {
    if (!selectedCustomer) {
      toast.error('لطفا مشتری را انتخاب کنید.');
      return;
    }

    const discountVal = Number(discount) || 0;
    const paidVal = paidAmount === '' ? (totalAmount - discountVal) : Number(paidAmount);

    // For credit sales or unpaid orders, account is optional
    // For sales with payment, account is required
    if (paidVal > 0 && !selectedAccount) {
      toast.error('لطفا حساب دریافت وجه را انتخاب کنید.');
      return;
    }

    if (!selectedWarehouse) {
      toast.error('لطفا انبار فروش را انتخاب کنید.');
      return;
    }

    setIsSubmitting(true);
    const result = await createOrder({
      customerId: selectedCustomer,
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        price: Number(item.product.sellPrice),
      })),
      paymentMethod,
      accountId: selectedAccount,
      totalAmount,
      discount: discountVal,
      paidAmount: paidVal,
      warehouseId: selectedWarehouse,
      saleDate: saleDate.toISOString(),
    });

    setIsSubmitting(false);
    if (result.success) {
      toast.success('سفارش با موفقیت ثبت شد.');
      setCart([]);
      setIsCheckoutOpen(false);
      setSelectedCustomer('');
    } else {
      toast.error(result.message);
    }
  };

  const debt = finalAmount - (paidAmount === '' ? finalAmount : Number(paidAmount));

  // Auto open cart sheet on mobile when adding item
  const handleAddToCart = (product: Product) => {
    addToCart(product);
    // Open cart sheet on mobile when first item is added
    if (cart.length === 0) {
      setIsCartOpen(true);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-100px)] gap-4 relative">
      {/* Products Section - Full width on mobile */}
      <div className="flex-1 overflow-y-auto p-2 md:p-4 bg-white rounded-lg border shadow-sm">
        <ProductGrid products={products} onAddToCart={handleAddToCart} cart={cart} />
      </div>
      
      {/* Cart Section - Desktop: Side panel */}
      <div className="hidden md:flex md:w-96 bg-white rounded-lg border shadow-sm flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <CartSummary
            cart={cart}
            onRemove={removeFromCart}
            onUpdateQuantity={updateQuantity}
            total={totalAmount}
          />
        </div>
        <div className="p-4 border-t bg-gray-50 flex-shrink-0">
          <Button
            className="w-full h-12 text-lg font-semibold"
            disabled={cart.length === 0}
            onClick={openCheckout}
          >
            تسویه حساب ({totalAmount.toLocaleString()} تومان)
          </Button>
        </div>
      </div>

      {/* Mobile: Fixed bottom button to open cart */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg z-40">
        <Button
          className="w-full h-16 text-lg font-semibold relative"
          disabled={cart.length === 0}
          onClick={() => setIsCartOpen(true)}
        >
          <ShoppingCart className="ml-2 h-6 w-6" />
          {cart.length > 0 ? (
            <>
              <span className="absolute top-2 left-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
              سبد خرید ({totalAmount.toLocaleString()} تومان)
            </>
          ) : (
            'سبد خرید خالی است'
          )}
        </Button>
      </div>

      {/* Mobile: Cart Sheet (Bottom Sheet) */}
      <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
        <SheetContent side="bottom" className="h-[85vh] flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-right">سبد خرید</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto mt-4">
            <CartSummary
              cart={cart}
              onRemove={removeFromCart}
              onUpdateQuantity={updateQuantity}
              total={totalAmount}
            />
          </div>
          <div className="p-4 border-t bg-gray-50 flex-shrink-0 space-y-2">
            <div className="flex justify-between items-center text-lg font-bold">
              <span>جمع کل:</span>
              <span>{totalAmount.toLocaleString()} تومان</span>
            </div>
            <Button
              className="w-full h-14 text-lg font-semibold"
              disabled={cart.length === 0}
              onClick={() => {
                setIsCartOpen(false);
                openCheckout();
              }}
            >
              تسویه حساب
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Checkout Dialog */}
      <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-right">نهایی کردن سفارش</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 md:space-y-4 py-4">
            <JalaliDatePicker
              name="saleDate"
              label="تاریخ فروش"
              defaultValue={saleDate}
              onChange={(date) => date && setSaleDate(date)}
              required
            />

            <div className="space-y-2">
              <Label className="text-base md:text-sm">انبار فروش *</Label>
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-base md:text-sm">مشتری *</Label>
                <Button 
                  variant="link" 
                  size="sm" 
                  className="text-base md:text-sm h-10 md:h-8"
                  onClick={() => setIsNewCustomerOpen(true)}
                >
                  + مشتری جدید
                </Button>
              </div>
              <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب مشتری" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-base md:text-sm">حساب دریافت وجه {paidAmount !== '0' && Number(paidAmount) > 0 ? '*' : ''}</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount} disabled={isCreditSale}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب صندوق/بانک" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show card/IBAN for selected bank account */}
              {(() => {
                const acc = accounts.find((a) => a.id === selectedAccount);
                if (!acc || (!acc.cardNumber && !acc.sheba)) return null;
                return (
                  <div className="text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-2 space-y-1" dir="ltr">
                    {acc.cardNumber && (
                      <div className="flex items-center justify-between">
                        <span className="text-blue-600 dark:text-blue-400 font-mono tracking-widest">{acc.cardNumber}</span>
                        <span className="text-blue-500 text-[10px] mr-2">شماره کارت</span>
                      </div>
                    )}
                    {acc.sheba && (
                      <div className="flex items-center justify-between">
                        <span className="text-blue-600 dark:text-blue-400 font-mono text-[11px]">{acc.sheba}</span>
                        <span className="text-blue-500 text-[10px] mr-2">شبا</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center space-x-2 space-x-reverse bg-orange-50 dark:bg-orange-950/20 p-3 rounded-lg border border-orange-200 dark:border-orange-900">
              <Checkbox
                id="creditSale"
                checked={isCreditSale}
                onCheckedChange={handleCreditSaleChange}
                className="data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
              />
              <label
                htmlFor="creditSale"
                className="text-base md:text-sm font-medium leading-none cursor-pointer text-orange-900 dark:text-orange-100"
              >
                فروش نسیه (بدهکار کردن مشتری)
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-4">
              <div className="space-y-2">
                <Label className="text-base md:text-sm">تخفیف (تومان)</Label>
                <Input 
                  type="number" 
                  value={discount} 
                  onChange={(e) => handleDiscountChange(e.target.value)}
                  className="h-12 md:h-10 text-base md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base md:text-sm">مبلغ پرداختی</Label>
                <Input
                  type="number"
                  value={paidAmount}
                  placeholder={finalAmount.toString()}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  disabled={isCreditSale}
                  className="h-12 md:h-10 text-base md:text-sm"
                />
              </div>
            </div>

            <div className="pt-4 border-t space-y-3 md:space-y-2">
              <div className="flex justify-between text-base md:text-sm">
                <span>مبلغ کل:</span>
                <span>{totalAmount.toLocaleString()} تومان</span>
              </div>
              <div className="flex justify-between text-base md:text-sm text-red-600">
                <span>تخفیف:</span>
                <span>{(Number(discount) || 0).toLocaleString()} تومان</span>
              </div>
              <div className="flex justify-between text-xl md:text-lg font-bold">
                <span>مبلغ قابل پرداخت:</span>
                <span>{finalAmount.toLocaleString()} تومان</span>
              </div>
              {debt > 0 && (
                <div className="flex justify-between text-base md:text-sm text-orange-600 font-medium bg-orange-50 p-3 md:p-2 rounded">
                  <span>مانده حساب (بدهی):</span>
                  <span>{debt.toLocaleString()} تومان</span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-3 md:gap-2">
            <Button 
              variant="outline" 
              onClick={() => setIsCheckoutOpen(false)}
              className="w-full sm:w-auto h-14 md:h-12 text-base md:text-sm font-semibold"
            >
              انصراف
            </Button>
            <Button
              onClick={handleCheckout}
              disabled={isSubmitting}
              className="w-full sm:w-auto h-14 md:h-12 text-base md:text-sm font-semibold"
            >
              {isSubmitting ? 'در حال ثبت...' : (isCreditSale ? 'ثبت سفارش و بدهی' : 'تایید و پرداخت')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={isNewCustomerOpen} onOpenChange={setIsNewCustomerOpen}>
        <DialogContent className="max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-right">تعریف مشتری جدید</DialogTitle>
          </DialogHeader>
          <QuickCustomerForm 
            onSuccess={(customerId, customerData) => {
              setIsNewCustomerOpen(false);
              // Add new customer to the list if we have the data
              if (customerData && customerData.id && customerData.name) {
                setCustomers((prev) => [...prev, customerData]);
                setSelectedCustomer(customerData.id);
                toast.success('مشتری جدید اضافه شد و انتخاب گردید.');
              } else {
                // Fallback: refresh server data without full page reload
                router.refresh();
                toast.success('مشتری جدید اضافه شد. لطفا مشتری را از لیست انتخاب کنید.');
              }
            }}
            onCancel={() => setIsNewCustomerOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Mobile: Add padding bottom for fixed button */}
      <div className="md:hidden h-24"></div>
    </div>
  );
}
