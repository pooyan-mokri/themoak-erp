'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShoppingCart, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ProductGrid } from './product-grid';
import { CartSummary, CartTotals } from './cart-summary';
import { Button } from '@/components/ui/button';
import { createOrder } from '@/actions/sales';
import { getCustomerCredit } from '@/actions/customer-credit';
import { creditUsable } from '@/lib/return-math';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/ui/tag-input';
import { QuickCustomerForm } from './quick-customer-form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { accountLabel } from '@/lib/account-label';
import { useRequestId } from '@/components/ui/request-id';
import { ReceiptUpload } from '@/components/accounting/receipt-upload';

interface Product {
  id: string;
  name: string;
  sku: string;
  sellPrice: any;
  image?: string;
  imageUrl?: string;
  barcode?: string;
  webId?: string;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  segment?: string;
}

interface Account {
  id: string;
  name: string;
  currency?: string;
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
  /** The warehouse a sale starts in (مشاهیر). */
  defaultWarehouseId?: string;
  /** Quantity by warehouse, then product; null when the role may not see stock (stock.view). */
  stock?: Record<string, Record<string, number>> | null;
  /** May record the sale and create a customer (sales.manage); the server checks it too. */
  canSell?: boolean;
  /** A product to start the cart with («فروش سریع» on the product page). */
  initialProductId?: string;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

export function POSInterface({
  products,
  customers: initialCustomers,
  accounts,
  warehouses,
  defaultWarehouseId,
  stock = null,
  canSell = true,
  initialProductId,
}: POSInterfaceProps) {
  const router = useRouter();
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>(() => {
    const first = initialProductId ? products.find((p) => p.id === initialProductId) : undefined;
    return first ? [{ product: first, quantity: 1 }] : [];
  });
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>(
    defaultWarehouseId || (warehouses.length > 0 ? warehouses[0].id : ''),
  );
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ACCOUNT'>('CASH');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [discount, setDiscount] = useState<string>('0');
  // A percent helper: typing a percent sets the discount amount, which is what is stored.
  const [discountPercent, setDiscountPercent] = useState<string>('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  // True once the cashier types a paid amount: a later discount edit leaves it alone.
  const [paidEdited, setPaidEdited] = useState(false);
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  const [orderTags, setOrderTags] = useState<string[]>([]);
  const [invoiceAccountId, setInvoiceAccountId] = useState<string>('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [requestId, renewRequestId] = useRequestId();
  // The selected customer's credit account, which can pay part of the sale without cash.
  const [customerCredit, setCustomerCredit] = useState(0);
  const [creditUsed, setCreditUsed] = useState<string>('0');

  useEffect(() => {
    setCustomerCredit(0);
    setCreditUsed('0');
    if (!selectedCustomer) return;
    getCustomerCredit(selectedCustomer)
      .then(setCustomerCredit)
      .catch(() => setCustomerCredit(0));
  }, [selectedCustomer]);

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
  const units = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Calculate final amount based on discount
  const finalAmount = totalAmount - (Number(discount) || 0);
  const creditVal = Math.max(0, Number(creditUsed) || 0);
  const creditMax = creditUsable(customerCredit, finalAmount);
  const creditTooMuch = creditVal > creditMax + 0.01;

  const customer = customers.find((c) => c.id === selectedCustomer);
  const warehouse = warehouses.find((w) => w.id === selectedWarehouse);
  const warehouseStock = stock ? stock[selectedWarehouse] ?? {} : null;

  // Reset checkout state when opening dialog
  const openCheckout = () => {
    // The customer is picked beside the cart; say so before the checkout opens.
    if (!selectedCustomer) {
      toast.error('لطفا مشتری را انتخاب کنید.');
      return;
    }
    setDiscount('0');
    setDiscountPercent('');
    setPaidAmount(totalAmount.toString());
    setPaidEdited(false);
    // Every sale picks its receiving account: two accounts can have nearly the same name.
    setSelectedAccount('');
    setIsCreditSale(false);
    setSaleDate(new Date());
    setOrderTags([]);
    setInvoiceAccountId('');
    setReceiptUrl('');
    setIsCartOpen(false);
    setCreditUsed('0');
    setIsCheckoutOpen(true);
  };

  // Credit spent lowers what is paid in cash, unless the cashier typed that.
  const handleCreditChange = (value: string) => {
    setCreditUsed(value);
    if (!isCreditSale && !paidEdited) {
      setPaidAmount(Math.max(0, finalAmount - (Number(value) || 0)).toString());
    }
  };

  // Update paidAmount when discount changes
  const handleDiscountChange = (value: string) => {
    setDiscount(value);
    if (!isCreditSale && !paidEdited) {
      const discountVal = Number(value) || 0;
      const newFinalAmount = totalAmount - discountVal;
      // Auto-update paidAmount to match the new final amount after discount
      // This ensures the paid amount reflects the discount
      setPaidAmount(Math.max(0, newFinalAmount - creditVal).toString());
    }
  };

  // The percent is only a way to type the amount: the amount in Toman is what the order stores.
  const handleDiscountPercentChange = (value: string) => {
    setDiscountPercent(value);
    const percent = Number(value);
    if (value === '' || !Number.isFinite(percent)) return;
    const clamped = Math.min(100, Math.max(0, percent));
    handleDiscountChange(String(Math.round((totalAmount * clamped) / 100)));
  };

  // Handle credit sale toggle
  const handleCreditSaleChange = (checked: boolean) => {
    setIsCreditSale(checked);
    setPaidEdited(false);
    if (checked) {
      // Credit sale: no payment now
      setPaidAmount('0');
    } else {
      // Regular sale: full payment
      setPaidAmount(Math.max(0, finalAmount - creditVal).toString());
    }
  };

  const handleCheckout = async () => {
    if (!selectedCustomer) {
      toast.error('لطفا مشتری را انتخاب کنید.');
      return;
    }

    const discountVal = Number(discount) || 0;
    const paidVal = paidAmount === '' ? (totalAmount - discountVal - creditVal) : Number(paidAmount);

    if (creditTooMuch) {
      toast.error(`از اعتبار مشتری حداکثر ${fa(creditMax)} تومان قابل استفاده است.`);
      return;
    }

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
      tags: orderTags,
      invoiceAccountId: invoiceAccountId || undefined,
      requestId,
      creditUsed: creditVal,
      // A sale with nothing paid has no money row to carry a receipt.
      receiptUrl: paidVal > 0 && receiptUrl ? receiptUrl : undefined,
    });

    setIsSubmitting(false);
    if (result.success) {
      renewRequestId();
      toast.success(result.message);
      setCart([]);
      setIsCheckoutOpen(false);
      setSelectedCustomer('');
      // Fresh stock on the cards after the sale.
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const debt = finalAmount - creditVal - (paidAmount === '' ? finalAmount - creditVal : Number(paidAmount));

  // On a phone the cart is a sheet: open it when the first item goes in.
  const handleAddToCart = (product: Product) => {
    addToCart(product);
    if (cart.length === 0 && !isDesktop()) {
      setIsCartOpen(true);
    }
  };

  // Warehouse and customer, beside the cart on a desktop and in the sheet on a phone.
  const saleSetup = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">انبار فروش *</Label>
        <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
          <SelectTrigger>
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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">مشتری *</Label>
          {canSell && (
            <button
              type="button"
              onClick={() => setIsNewCustomerOpen(true)}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" />
              مشتری جدید
            </button>
          )}
        </div>
        <Select
          value={selectedCustomer}
          onValueChange={(id) => {
            // Another customer's credit: nothing of it is spent yet.
            handleCreditChange('0');
            setSelectedCustomer(id);
          }}
        >
          <SelectTrigger>
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
        {customer && (customer.phone || customer.segment) && (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {customer.phone && (
              <span className="font-mono" dir="ltr">
                {customer.phone}
              </span>
            )}
            {customer.segment && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{customer.segment}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );

  const confirmButton = (
    <>
      <Button className="h-11 w-full text-[14px]" disabled={cart.length === 0 || !canSell} onClick={openCheckout}>
        <Check className="h-4 w-4" />
        تأیید و تسویه
      </Button>
      {!canSell && (
        <p className="text-center text-[12px] text-muted-foreground">
          ثبت فروش فقط برای نقش‌هایی است که اجازهٔ فروش دارند.
        </p>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-104px)]">
      <PageHeader
        title="صندوق فروش"
        description={
          <>
            <span className="hidden md:inline">
              <span className="font-mono text-[11px]">F</span> جستجو، <span className="font-mono text-[11px]">↵</span> افزودن
              اولین نتیجه ·{' '}
            </span>
            اسکنر بارکد مستقیم در جستجو می‌نویسد
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        {/* Catalogue */}
        <section className="min-h-0 min-w-0 flex-1">
          <ProductGrid
            products={products}
            onAddToCart={handleAddToCart}
            cart={cart}
            stock={warehouseStock}
            warehouseName={warehouse?.name}
          />
        </section>

        {/* Cart — desktop */}
        <aside className="hidden min-h-0 shrink-0 flex-col rounded-lg border bg-card md:flex md:w-[320px] lg:w-[360px] xl:w-[400px]">
          <div className="space-y-3 border-b p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">سبد فروش</h2>
              <span className="text-[12px] text-muted-foreground">
                {cart.length ? `${fa(units)} عدد` : 'خالی'}
              </span>
            </div>
            {saleSetup}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CartSummary cart={cart} onRemove={removeFromCart} onUpdateQuantity={updateQuantity} stock={warehouseStock} />
          </div>
          <div className="space-y-3 border-t p-4">
            <CartTotals cart={cart} />
            {confirmButton}
          </div>
        </aside>
      </div>

      {/* Mobile: the button that opens the cart, fixed just above the phone tab bar (h-16), which would cover it. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-card p-3 md:hidden">
        <Button className="h-12 w-full text-[14px]" disabled={cart.length === 0} onClick={() => setIsCartOpen(true)}>
          <ShoppingCart className="h-5 w-5" />
          {cart.length > 0 ? `سبد فروش · ${fa(units)} عدد · ${fa(totalAmount)} تومان` : 'سبد فروش خالی است'}
        </Button>
      </div>

      {/* Mobile: Cart Sheet (Bottom Sheet) */}
      <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
        <SheetContent side="bottom" className="flex h-[85vh] flex-col gap-0 bg-card p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-start text-sm font-medium">سبد فروش</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b p-4">{saleSetup}</div>
            <CartSummary cart={cart} onRemove={removeFromCart} onUpdateQuantity={updateQuantity} stock={warehouseStock} />
          </div>
          <div className="space-y-3 border-t p-4">
            <CartTotals cart={cart} />
            {confirmButton}
          </div>
        </SheetContent>
      </Sheet>

      {/* Checkout Dialog */}
      <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-start">نهایی کردن سفارش</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-secondary px-3 py-2 text-[12.5px] text-muted-foreground">
              مشتری: <span className="font-medium text-foreground">{customer?.name ?? '—'}</span>
              {' · '}انبار: <span className="text-foreground">{warehouse?.name ?? '—'}</span>
              {' · '}
              <span className="tabular-nums">{fa(units)} عدد</span>
            </div>

            <JalaliDatePicker
              name="saleDate"
              label="تاریخ فروش"
              defaultValue={saleDate}
              onChange={(date) => date && setSaleDate(date)}
              required
            />

            <div className="space-y-1.5">
              <Label>حساب دریافت وجه {paidAmount !== '0' && Number(paidAmount) > 0 ? '*' : ''}</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount} disabled={isCreditSale}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب صندوق/بانک" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show card/IBAN for selected bank account */}
              {(() => {
                const acc = accounts.find((a) => a.id === selectedAccount);
                if (!acc || (!acc.cardNumber && !acc.sheba)) return null;
                return <AccountNumbers account={acc} />;
              })()}
              {!isCreditSale && (
                <ReceiptUpload
                  currentUrl={receiptUrl}
                  onUploadComplete={(url) => setReceiptUrl(url)}
                  onRemove={() => setReceiptUrl('')}
                />
              )}
            </div>

            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox id="creditSale" checked={isCreditSale} onCheckedChange={handleCreditSaleChange} />
              <label htmlFor="creditSale" className="cursor-pointer text-[13.5px] font-medium leading-none">
                فروش نسیه (بدهکار کردن مشتری)
              </label>
            </div>

            {isCreditSale && (
              <div className="space-y-1.5 rounded-md border p-3">
                <Label>حساب بانکی برای درج در فاکتور</Label>
                <p className="text-xs text-muted-foreground">شماره کارت و شبا این حساب در فاکتور چاپ میشه</p>
                <Select value={invoiceAccountId} onValueChange={setInvoiceAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب حساب (اختیاری)" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.cardNumber || a.sheba).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {accountLabel(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {invoiceAccountId && (() => {
                  const acc = accounts.find((a) => a.id === invoiceAccountId);
                  if (!acc) return null;
                  return <AccountNumbers account={acc} />;
                })()}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>تخفیف (تومان)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={discount}
                    onChange={(e) => {
                      setDiscountPercent('');
                      handleDiscountChange(e.target.value);
                    }}
                    className="min-w-0 flex-1"
                  />
                  <div className="relative w-20 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={discountPercent}
                      onChange={(e) => handleDiscountPercentChange(e.target.value)}
                      aria-label="تخفیف به درصد"
                      placeholder="درصد"
                      className="pe-7"
                    />
                    <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">٪</span>
                  </div>
                </div>
                {Number(discount) > 0 && totalAmount > 0 && (
                  <p className="text-[11.5px] text-muted-foreground">
                    {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format((Number(discount) / totalAmount) * 100)}٪
                    از مبلغ کل
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>مبلغ پرداختی (تومان)</Label>
                <Input
                  type="number"
                  value={paidAmount}
                  placeholder={finalAmount.toString()}
                  onChange={(e) => {
                    setPaidAmount(e.target.value);
                    setPaidEdited(true);
                  }}
                  disabled={isCreditSale}
                />
              </div>
            </div>

            {/* The customer's credit («بستانکار») can pay part of the sale without cash. */}
            {customerCredit > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted-foreground">اعتبار مشتری</span>
                  <span className="font-medium tabular-nums">
                    {fa(customerCredit)}
                    <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
                  </span>
                </div>
                <Label htmlFor="creditUsed">استفاده از اعتبار (تومان)</Label>
                <div className="flex gap-2">
                  <Input
                    id="creditUsed"
                    type="number"
                    min="0"
                    max={creditMax}
                    value={creditUsed}
                    onChange={(e) => handleCreditChange(e.target.value)}
                    className="min-w-0 flex-1"
                  />
                  <Button type="button" variant="outline" onClick={() => handleCreditChange(String(creditMax))}>
                    همهٔ اعتبار
                  </Button>
                </div>
                {creditTooMuch && (
                  <p className="text-[12.5px] text-danger">حداکثر {fa(creditMax)} تومان قابل استفاده است.</p>
                )}
              </div>
            )}

            <TagInput
              label="تگ‌ها (اختیاری)"
              placeholder="مثلا: عمده، تخفیف ویژه..."
              value={orderTags}
              onChange={setOrderTags}
            />

            <dl className="space-y-1.5 border-t pt-3 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">مبلغ کل</dt>
                <dd className="tabular-nums">{fa(totalAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">تخفیف</dt>
                <dd className="tabular-nums">{(Number(discount) || 0) > 0 ? `− ${fa(Number(discount) || 0)}` : fa(0)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t pt-2">
                <dt className="font-medium">مبلغ قابل پرداخت</dt>
                <dd className="text-[17px] font-medium tabular-nums">
                  {fa(finalAmount)}
                  <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
                </dd>
              </div>
              {creditVal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">از اعتبار مشتری</dt>
                  <dd className="tabular-nums">− {fa(creditVal)}</dd>
                </div>
              )}
              {debt > 0 && (
                <div className="flex justify-between rounded-md bg-warning-soft px-3 py-2 text-warning">
                  <dt>مانده حساب (بدهی)</dt>
                  <dd className="font-medium tabular-nums">{fa(debt)} تومان</dd>
                </div>
              )}
            </dl>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setIsCheckoutOpen(false)} className="w-full sm:w-auto">
              انصراف
            </Button>
            <Button onClick={handleCheckout} disabled={isSubmitting} className="w-full sm:w-auto">
              <Check className="h-4 w-4" />
              {isSubmitting ? 'در حال ثبت...' : (isCreditSale ? 'ثبت سفارش و بدهی' : 'تایید و پرداخت')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={isNewCustomerOpen} onOpenChange={setIsNewCustomerOpen}>
        <DialogContent className="max-h-[90vh] max-w-[500px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start">تعریف مشتری جدید</DialogTitle>
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
      <div className="h-20 md:hidden"></div>
    </div>
  );
}

/** A bank account's card number and IBAN, as the cashier reads them to the customer. */
function AccountNumbers({ account }: { account: Account }) {
  return (
    <div className="space-y-1 rounded-md border bg-secondary px-3 py-2 text-xs" dir="ltr">
      {account.cardNumber && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono tracking-widest">{account.cardNumber}</span>
          <span className="text-[11px] text-muted-foreground">شماره کارت</span>
        </div>
      )}
      {account.sheba && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px]">{account.sheba}</span>
          <span className="text-[11px] text-muted-foreground">شبا</span>
        </div>
      )}
    </div>
  );
}
