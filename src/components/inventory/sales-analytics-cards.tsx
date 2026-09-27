'use client';

import { SectionCard } from '@/components/dashboard/section-card';

interface SalesAnalyticsCardsProps {
  analytics: {
    totalUnitsSold: number;
    // Both absent without sales.view.
    totalRevenue?: number;
    avgSellingPrice?: number;
    velocityPerWeek: number;
    velocityPerMonth: number;
    velocityPerYear: number;
  };
}

const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);

/** Sales so far, from the orders that were not cancelled: units, money (sales.view), pace and the price it really sold at. */
export function SalesAnalyticsCards({ analytics }: SalesAnalyticsCardsProps) {
  const rows: Array<{ label: string; value: string; unit: string; note?: string }> = [
    { label: 'کل فروش', value: fa(analytics.totalUnitsSold), unit: 'عدد', note: 'واحد فروخته شده' },
    ...(analytics.totalRevenue !== undefined
      ? [{ label: 'درآمد کل', value: fa(analytics.totalRevenue), unit: 'تومان', note: 'از ابتدا تا کنون' }]
      : []),
    { label: 'سرعت فروش', value: fa(analytics.velocityPerMonth, 1), unit: 'در ماه', note: `${fa(analytics.velocityPerWeek, 1)} در هفته` },
    ...(analytics.avgSellingPrice !== undefined
      ? [{ label: 'میانگین قیمت', value: fa(analytics.avgSellingPrice), unit: 'تومان', note: 'قیمت واقعی فروش' }]
      : []),
  ];

  return (
    <SectionCard title="عملکرد فروش">
      <dl className="divide-y">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-11 items-center justify-between gap-3 py-2">
            <dt>
              <span className="block text-[13.5px]">{row.label}</span>
              {row.note && <span className="block text-[11.5px] text-muted-foreground">{row.note}</span>}
            </dt>
            <dd className="text-end text-[15px] font-medium tabular-nums">
              {row.value}
              <small className="ms-1 text-[11px] font-normal text-muted-foreground">{row.unit}</small>
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
