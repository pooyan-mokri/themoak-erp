'use client';

import { useState } from 'react';
import { SectionCard } from '@/components/dashboard/section-card';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

/** A sale or a purchase line of this product (getProductMovementHistory). */
interface Movement {
  id: string;
  date: Date | string;
  dateFormatted?: string;
  type: 'SALE' | 'PURCHASE';
  quantity: number;
  reference: string;
  status: string;
}

/** A row of the stock ledger (InventoryMovement): transfers, adjustments, receipts, website sales and returns. */
export interface WarehouseMovement {
  id: string;
  type: 'TRANSFER' | 'ADJUSTMENT' | 'SALE' | 'RETURN' | 'PURCHASE';
  quantity: number;
  from: string | null;
  to: string | null;
  note: string;
  dateFormatted: string;
}

interface MovementHistoryProps {
  movements: Movement[];
  /** Absent when the stock ledger could not be read. */
  warehouseMovements?: WarehouseMovement[];
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

const MOVEMENT_TYPES: Record<WarehouseMovement['type'], string> = {
  TRANSFER: 'انتقال',
  ADJUSTMENT: 'تعدیل',
  SALE: 'فروش',
  RETURN: 'مرجوعی',
  PURCHASE: 'خرید',
};

// Order and purchase order statuses, as colour and word (design system §12).
const STATUSES: Record<string, { label: string; tone: string }> = {
  COMPLETED: { label: 'تکمیل شده', tone: 'bg-success-soft text-success' },
  DELIVERED: { label: 'تحویل داده شده', tone: 'bg-success-soft text-success' },
  RECEIVED: { label: 'دریافت شده', tone: 'bg-success-soft text-success' },
  CONFIRMED: { label: 'تأیید شده', tone: 'bg-brand-soft text-brand' },
  DRAFT: { label: 'پیش‌نویس', tone: 'bg-brand-soft text-brand' },
  PENDING_PAYMENT: { label: 'منتظر پرداخت', tone: 'bg-warning-soft text-warning' },
  PARTIALLY_PAID: { label: 'پرداخت جزئی', tone: 'bg-brand-soft text-brand' },
  PAID: { label: 'پرداخت شده', tone: 'bg-brand-soft text-brand' },
  IN_PRODUCTION: { label: 'در حال تولید', tone: 'bg-brand-soft text-brand' },
  ARRIVED: { label: 'رسیده به مقصد', tone: 'bg-brand-soft text-brand' },
  PARTIALLY_RECEIVED: { label: 'نیمه دریافت شده', tone: 'bg-brand-soft text-brand' },
  CANCELLED: { label: 'لغو شده', tone: 'bg-danger-soft text-danger' },
};

const th = 'h-9 whitespace-nowrap bg-secondary px-3 text-xs font-normal text-muted-foreground';

/** In, out or across: a receipt adds, a sale takes, a transfer only moves between warehouses. */
function signed(m: WarehouseMovement) {
  if (m.from && m.to) return fa(m.quantity);
  return m.to ? `+${fa(m.quantity)}` : `−${fa(m.quantity)}`;
}

function where(m: WarehouseMovement) {
  if (m.from && m.to) return `${m.from} ← ${m.to}`;
  if (m.to) return `به ${m.to}`;
  if (m.from) return `از ${m.from}`;
  return '—';
}

/** The product's history in two views: the stock ledger by warehouse, and its sale and purchase lines. */
export function MovementHistory({ movements, warehouseMovements }: MovementHistoryProps) {
  const hasLedger = warehouseMovements !== undefined;
  const [tab, setTab] = useState<'stock' | 'orders'>(hasLedger ? 'stock' : 'orders');

  const tabs = [
    ...(hasLedger ? [{ id: 'stock' as const, label: 'حرکت‌های انبار', count: warehouseMovements.length }] : []),
    { id: 'orders' as const, label: 'فروش و خرید', count: movements.length },
  ];

  return (
    <SectionCard
      title="تاریخچه حرکت‌ها"
      count={tab === 'stock' ? 'آخرین ۵۰' : 'آخرین ۲۰'}
      aside={
        <div className="flex items-center border-b" role="tablist">
          {tabs.map((t) => (
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
              <span className="ms-1 font-mono text-[11px] opacity-70">{fa(t.count)}</span>
            </button>
          ))}
        </div>
      }
    >
      {tab === 'stock' && hasLedger ? (
        warehouseMovements.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            هنوز جابجایی، تعدیل یا دریافتی برای این کالا در انبارها ثبت نشده است. فروش‌های صندوق در «فروش و خرید» آمده‌اند.
          </p>
        ) : (
          <div className="-mx-4 -mb-4 overflow-x-auto rounded-b-lg border-t">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <th className={cn(th, 'ps-4 text-start')}>تاریخ</th>
                  <th className={cn(th, 'text-start')}>نوع</th>
                  <th className={cn(th, 'text-start')}>انبار</th>
                  <th className={cn(th, 'text-end')}>تعداد</th>
                  <th className={cn(th, 'pe-4 text-start')}>شرح</th>
                </tr>
              </thead>
              <tbody>
                {warehouseMovements.map((m) => (
                  <tr key={m.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                    <td className="whitespace-nowrap ps-4 pe-3 font-mono text-[12px] text-muted-foreground">{m.dateFormatted}</td>
                    <td className="px-3">
                      <span className="whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                        {MOVEMENT_TYPES[m.type] ?? m.type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 text-[12.5px]">{where(m)}</td>
                    <td className="px-3 text-end font-medium tabular-nums">
                      <span dir="ltr">{signed(m)}</span>
                    </td>
                    <td className="max-w-[280px] truncate pe-4 ps-3 text-[12.5px] text-muted-foreground" title={m.note || undefined}>
                      {m.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : movements.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          این کالا هنوز در هیچ سفارش فروش یا خریدی نیامده است.
        </p>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto rounded-b-lg border-t">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <th className={cn(th, 'ps-4 text-start')}>تاریخ</th>
                <th className={cn(th, 'text-start')}>نوع</th>
                <th className={cn(th, 'text-end')}>تعداد</th>
                <th className={cn(th, 'text-start')}>مرجع</th>
                <th className={cn(th, 'pe-4 text-start')}>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => {
                const status = STATUSES[movement.status] ?? { label: movement.status, tone: 'bg-secondary text-muted-foreground' };
                return (
                  <tr key={movement.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                    <td className="whitespace-nowrap ps-4 pe-3 font-mono text-[12px] text-muted-foreground">
                      {movement.dateFormatted || formatJalaliDate(movement.date, 'jYYYY/jMM/jDD HH:mm')}
                    </td>
                    <td className="px-3">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                        {movement.type === 'SALE' ? 'فروش' : 'خرید'}
                      </span>
                    </td>
                    <td className="px-3 text-end font-medium tabular-nums">
                      <span dir="ltr">
                        {movement.quantity > 0 ? '+' : movement.quantity < 0 ? '−' : ''}
                        {fa(Math.abs(movement.quantity))}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-3 text-[12.5px] text-muted-foreground">
                      {movement.reference === 'Walk-in' ? 'مشتری عمومی' : movement.reference}
                    </td>
                    <td className="pe-4 ps-3">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
