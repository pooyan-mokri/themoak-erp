'use client';

import { Boxes, PackageCheck, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/kpi-card';

interface StockKPICardsProps {
  product: {
    totalStock: number;
    availableStock: number;
    /** Absent without cost.view. */
    stockValue?: number;
  };
  /** Warehouses holding a row for this product. */
  warehouseCount?: number;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

/** Units everywhere, units that can be sold, and (for cost viewers) what they are worth. Grid items of the page's strip. */
export function StockKPICards({ product, warehouseCount }: StockKPICardsProps) {
  return (
    <>
      <KpiCard
        label="موجودی کل"
        icon={Boxes}
        value={fa(product.totalStock)}
        unit="عدد"
        note={warehouseCount !== undefined ? `در ${fa(warehouseCount)} انبار` : 'تمام انبارها'}
      />
      <KpiCard label="قابل فروش" icon={PackageCheck} value={fa(product.availableStock)} unit="عدد" note="انبارهای فیزیکی" />
      {product.stockValue !== undefined && (
        <KpiCard label="ارزش موجودی" icon={Wallet} value={fa(product.stockValue)} unit="تومان" note="بر اساس قیمت تمام‌شده" />
      )}
    </>
  );
}
