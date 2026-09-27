'use client';

import { KpiCard } from '@/components/dashboard/kpi-card';

interface FinancialKPICardsProps {
  product: {
    // Each is absent when the viewer may not see it (cost.view, sales.view).
    costPrice?: number;
    sellPrice?: number;
  };
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

/** Cost, sell price and margin, each only for a role that may see it. Grid items of the page's strip. */
export function FinancialKPICards({ product }: FinancialKPICardsProps) {
  const { costPrice, sellPrice } = product;
  const margin = costPrice !== undefined && sellPrice !== undefined && sellPrice > 0
    ? ((sellPrice - costPrice) / sellPrice) * 100
    : 0;

  return (
    <>
      {costPrice !== undefined && <KpiCard label="قیمت خرید" value={fa(costPrice)} unit="تومان" note="قیمت تمام‌شده" />}
      {sellPrice !== undefined && <KpiCard label="قیمت فروش" value={fa(sellPrice)} unit="تومان" note="قیمت پیشنهادی" />}
      {costPrice !== undefined && sellPrice !== undefined && (
        <KpiCard
          label="حاشیه سود"
          value={`${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(margin)}٪`}
          note="از قیمت فروش"
        />
      )}
    </>
  );
}
