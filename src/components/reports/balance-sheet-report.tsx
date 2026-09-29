'use client';

import { SectionCard } from '@/components/dashboard/section-card';
import { formatJalaliDate } from '@/lib/date-utils';
import type { CashPosition } from '@/lib/money-totals';
import { ACCOUNT_TYPE_LABELS } from '@/lib/account-label';
import { cn } from '@/lib/utils';

interface BalanceSheetData {
  assets: {
    /** Every account that holds money, foreign ones converted at the latest rate. */
    cash: number;
    cashByType?: CashPosition['byType'];
    /** The foreign currencies converted, with the rate used. */
    foreignCash?: CashPosition['foreign'];
    /** Foreign currencies with no rate recorded: not in the cash. */
    unpricedCash?: CashPosition['unpriced'];
    inventory: number;
    consignmentInventory?: number;
    accountsReceivable: number;
    /** Paid on purchase orders whose goods are not in stock yet. */
    prepaidPurchases?: number;
    total: number;
  };
  liabilities: {
    accountsPayable: number;
    total: number;
  };
  equity: {
    total: number;
  };
}

interface BalanceSheetReportProps {
  data: BalanceSheetData;
}

/** The indigo series, for the parts of the asset bar. */
const COLORS = ['#353DB2', '#7C82D0', '#A9AEDE', '#2D333D', '#5B62C4'];

const fa = (value: number) => new Intl.NumberFormat('fa-IR').format(Math.round(value));
const number = (value: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value);

/** A line of a block: a figure in Toman, or (a detail of the line above it) a figure or a note. */
type Row = { label: string; value?: number; text?: string; detail?: boolean; warning?: boolean };

function Block({ title, total, rows }: { title: string; total: number; rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b">
            <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">{title}</th>
            <th className="h-9 bg-secondary px-4 text-end text-xs font-normal text-muted-foreground">تومان</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className={cn(
                'border-b transition-colors duration-150 hover:bg-brand/[.04]',
                row.detail ? 'h-8 text-[12px]' : 'h-11',
                row.warning ? 'text-warning' : !row.detail && 'text-muted-foreground',
              )}
            >
              <td className={cn('px-4', row.detail ? 'ps-12 text-muted-foreground' : 'ps-8')}>{row.label}</td>
              <td className={cn('px-4 text-end tabular-nums', !row.detail && 'text-foreground')}>
                {row.text ?? (row.value !== undefined ? fa(row.value) : '')}
              </td>
            </tr>
          ))}
          <tr className="h-11 bg-secondary font-medium">
            <td className="px-4">جمع {title}</td>
            <td className="px-4 text-end tabular-nums">{fa(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BalanceSheetReport({ data }: BalanceSheetReportProps) {
  const { assets, liabilities, equity } = data;

  const assetBreakdown = [
    { name: 'نقدینگی', value: assets.cash },
    { name: 'موجودی کالا (خودی)', value: assets.inventory },
    { name: 'کالای امانی نزد همکاران', value: assets.consignmentInventory ?? 0 },
    { name: 'حساب‌های دریافتنی', value: assets.accountsReceivable },
    { name: 'پیش‌پرداخت خرید (کالای دریافت‌نشده)', value: assets.prepaidPurchases ?? 0 },
  ];
  const positive = assetBreakdown.reduce((sum, part) => sum + Math.max(0, part.value), 0);

  // Cash is every account that holds money: its account types, each foreign currency with the rate it was
  // converted at, and a currency with no rate, shown on its own and not added (src/lib/money-totals.ts).
  const cashDetails: Row[] = [
    ...(assets.cashByType ?? []).map((part) => ({ label: ACCOUNT_TYPE_LABELS[part.type] ?? part.type, value: part.total, detail: true })),
    ...(assets.foreignCash ?? []).map((foreign) => ({
      label: `شامل ${foreign.currency}`,
      text: `${number(foreign.total)} ${foreign.currency} ≈ ${fa(foreign.approxToman)} (نرخ ${number(foreign.rate)} در ${formatJalaliDate(foreign.rateDate)})`,
      detail: true,
    })),
    ...(assets.unpricedCash ?? []).map((unpriced) => ({
      label: unpriced.currency,
      text: `${number(unpriced.total)} ${unpriced.currency} — نرخی ثبت نشده است (در جمع نیست)`,
      detail: true,
      warning: true,
    })),
  ];
  const assetRows: Row[] = assetBreakdown.flatMap((part, index) => [
    { label: part.name, value: part.value },
    ...(index === 0 ? cashDetails : []),
  ]);

  return (
    <div className="space-y-4">
      <SectionCard title="تفکیک دارایی‌ها" aside={<span className="text-muted-foreground">وضعیت امروز</span>}>
        <div className="flex h-[22px] gap-0.5 overflow-hidden rounded bg-secondary">
          {positive > 0 &&
            assetBreakdown
              .filter((part) => part.value > 0)
              .map((part) => (
                <span
                  key={part.name}
                  title={`${part.name}: ${fa(part.value)} تومان`}
                  className="block h-full"
                  style={{ width: `${(part.value / positive) * 100}%`, background: COLORS[assetBreakdown.indexOf(part) % COLORS.length] }}
                />
              ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
          {assetBreakdown.map((part, index) => (
            <span key={part.name} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[index % COLORS.length] }} />
              {part.name} ·{' '}
              <span className="tabular-nums">{positive > 0 ? `${fa((Math.max(0, part.value) / positive) * 100)}٪` : '—'}</span>
            </span>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        <Block title="دارایی‌ها" total={assets.total} rows={assetRows} />
        <div className="space-y-4">
          <Block title="بدهی‌ها" total={liabilities.total} rows={[{ label: 'حساب‌های پرداختنی', value: liabilities.accountsPayable }]} />
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex h-11 items-center justify-between bg-brand-soft px-4 font-medium text-brand">
              <span>سرمایه</span>
              <span className="tabular-nums">{fa(equity.total)}</span>
            </div>
            <p className="px-4 py-2.5 text-[12.5px] text-muted-foreground">دارایی‌ها − بدهی‌ها = سرمایه</p>
          </div>
        </div>
      </div>
    </div>
  );
}
