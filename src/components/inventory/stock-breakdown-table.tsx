'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SectionCard } from '@/components/dashboard/section-card';
import { cn } from '@/lib/utils';
import { STOCK_STATUS, stockStatus } from './stock-status';

interface StockBreakdownItem {
  warehouseId: string;
  warehouseName: string;
  isVirtual: boolean;
  quantity: number;
  status: string;
}

interface StockBreakdownTableProps {
  breakdown: StockBreakdownItem[];
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

const TABS = [
  { id: 'all', label: 'همه', match: () => true },
  { id: 'physical', label: 'فیزیکی', match: (item: StockBreakdownItem) => !item.isVirtual },
  { id: 'virtual', label: 'مجازی', match: (item: StockBreakdownItem) => item.isVirtual },
] as const;

/** Stock by warehouse, physical or virtual (consignment), with each one's share of the product's total. */
export function StockBreakdownTable({ breakdown }: StockBreakdownTableProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all');
  const total = breakdown.reduce((sum, item) => sum + item.quantity, 0);
  // Shares are of the units actually on hand, so a warehouse below zero cannot push the others past 100٪.
  const onHand = breakdown.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const rows = breakdown.filter(current.match).sort((a, b) => b.quantity - a.quantity);
  const shown = rows.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SectionCard
      title="توزیع موجودی در انبارها"
      count={fa(breakdown.length)}
      aside={
        breakdown.length > 0 && (
          <div className="flex items-center border-b" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px h-8 border-b-2 px-2.5 text-[12.5px] transition-colors duration-150',
                  tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                <span className="ms-1 font-mono text-[11px] opacity-70">{fa(breakdown.filter(t.match).length)}</span>
              </button>
            ))}
          </div>
        )
      }
    >
      {breakdown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          این کالا در هیچ انباری موجودی ندارد. با دریافت سفارش خرید یا انتقال بین انبارها موجودی می‌گیرد.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          این کالا در انبار {tab === 'virtual' ? 'مجازی (امانی)' : 'فیزیکی'} ثبت نشده است.
        </p>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto rounded-b-lg border-t">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">انبار</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">نوع</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">موجودی (عدد)</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">سهم از کل</th>
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const share = onHand > 0 ? Math.max(0, item.quantity) / onHand : 0;
                const status = STOCK_STATUS[stockStatus(item.quantity)];
                return (
                  <tr key={item.warehouseId} className="h-11 border-b transition-colors duration-150 hover:bg-brand/[.04]">
                    <td className="px-4">
                      <Link href={`/dashboard/inventory/warehouses/${item.warehouseId}`} className="hover:text-brand hover:underline">
                        {item.warehouseName}
                      </Link>
                    </td>
                    <td className="px-3 text-[12.5px] text-muted-foreground">{item.isVirtual ? 'مجازی (امانی)' : 'فیزیکی'}</td>
                    <td className="px-3 text-end font-medium tabular-nums">{fa(item.quantity)}</td>
                    <td className="px-3">
                      <div className="flex items-center gap-2">
                        <span className="block h-1 w-20 overflow-hidden rounded-full bg-secondary">
                          <span className="block h-full bg-brand" style={{ width: `${share * 100}%` }} />
                        </span>
                        <span className="w-9 font-mono text-[11px] text-muted-foreground">{fa(Math.round(share * 100))}٪</span>
                      </div>
                    </td>
                    <td className="px-4">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-secondary text-[12.5px]">
                <td className="h-9 px-4 font-medium" colSpan={2}>
                  {tab === 'all' ? 'جمع کل' : `جمع ${current.label}`}
                </td>
                <td className="px-3 text-end font-medium tabular-nums">{fa(shown)}</td>
                <td className="px-3 font-mono text-[11px] text-muted-foreground" colSpan={2}>
                  {tab !== 'all' && onHand > 0 && `${fa(Math.round((rows.reduce((sum, item) => sum + Math.max(0, item.quantity), 0) / onHand) * 100))}٪ از ${fa(total)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
