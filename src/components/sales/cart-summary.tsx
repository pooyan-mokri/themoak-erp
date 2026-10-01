'use client';

import { Minus, Plus, ShoppingCart, X } from 'lucide-react';
import { ProductPhoto } from '@/components/inventory/product-photo';

interface Product {
  id: string;
  name: string;
  sku?: string;
  sellPrice: any;
  image?: string;
  imageUrl?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface CartSummaryProps {
  cart: CartItem[];
  onRemove: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  /** Quantity per product in the sale's warehouse; null when the role may not see stock. */
  stock?: Record<string, number> | null;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

/** The cart's lines: photo, name and code, quantity stepper, line total, remove. */
export function CartSummary({ cart, onRemove, onUpdateQuantity, stock = null }: CartSummaryProps) {
  if (cart.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-10 text-center text-muted-foreground">
        <ShoppingCart className="h-6 w-6" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-foreground">سبد خالی است</p>
        <p className="text-[12px]">کالا را از فهرست انتخاب کنید یا بارکدش را اسکن کنید.</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {cart.map((item) => {
        const photo = item.product.imageUrl || item.product.image;
        const available = stock ? stock[item.product.id] ?? 0 : null;
        const over = available !== null && item.quantity > available;
        return (
          <div key={item.product.id} className="flex gap-2.5 px-4 py-2.5">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-secondary">
              <ProductPhoto src={photo} alt="" className="h-full w-full object-cover object-[50%_60%]" fallback={null} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-[13px] font-medium">
                    {item.product.name}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {item.product.sku && (
                      <>
                        <span className="font-mono" dir="ltr">
                          {item.product.sku}
                        </span>
                        {' · '}
                      </>
                    )}
                    <span className="tabular-nums">{fa(Number(item.product.sellPrice))}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.product.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-danger-soft hover:text-danger md:h-7 md:w-7"
                  aria-label={`حذف ${item.product.name} از سبد`}
                  title="حذف از سبد"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center rounded-md border bg-secondary">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.product.id, -1)}
                    disabled={item.quantity <= 1}
                    className="grid h-8 w-8 place-items-center rounded-s-md transition-colors duration-150 hover:bg-card disabled:opacity-40 md:h-7 md:w-7"
                    aria-label="یکی کمتر"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[1.75rem] text-center text-[13px] font-medium tabular-nums">{fa(item.quantity)}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.product.id, 1)}
                    className="grid h-8 w-8 place-items-center rounded-e-md transition-colors duration-150 hover:bg-card md:h-7 md:w-7"
                    aria-label="یکی بیشتر"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="text-[13.5px] font-medium tabular-nums">
                  {fa(Number(item.product.sellPrice) * item.quantity)}
                </span>
              </div>
              {over && (
                <span className="inline-block rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning">
                  بیش از موجودی انبار ({fa(Math.max(0, available))})
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The cart's totals block: units and the sum. Discount and payment come in the checkout. */
export function CartTotals({ cart }: { cart: CartItem[] }) {
  const units = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + Number(item.product.sellPrice) * item.quantity, 0);
  return (
    <dl className="space-y-1.5 text-[13px]">
      <div className="flex items-center justify-between text-muted-foreground">
        <dt>تعداد</dt>
        <dd className="tabular-nums">
          {fa(cart.length)} کالا · {fa(units)} عدد
        </dd>
      </div>
      <div className="flex items-baseline justify-between border-t pt-2">
        <dt className="font-medium">جمع کل</dt>
        <dd className="text-[17px] font-medium tabular-nums">
          {fa(total)}
          <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
        </dd>
      </div>
      <p className="text-[11.5px] text-muted-foreground">تخفیف، پرداخت و تاریخ فروش در مرحلهٔ تسویه.</p>
    </dl>
  );
}
