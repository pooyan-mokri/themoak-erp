'use client';

import { SectionCard } from '@/components/dashboard/section-card';

interface BalanceSheetData {
  assets: {
    cash: number;
    inventory: number;
    consignmentInventory?: number;
    accountsReceivable: number;
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
const COLORS = ['#353DB2', '#7C82D0', '#A9AEDE', '#2D333D'];

const fa = (value: number) => new Intl.NumberFormat('fa-IR').format(Math.round(value));

function Block({ title, total, rows }: { title: string; total: number; rows: Array<{ label: string; value: number }> }) {
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
            <tr key={row.label} className="h-11 border-b transition-colors duration-150 hover:bg-brand/[.04]">
              <td className="px-4 ps-8 text-muted-foreground">{row.label}</td>
              <td className="px-4 text-end tabular-nums">{fa(row.value)}</td>
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
  ];
  const positive = assetBreakdown.reduce((sum, part) => sum + Math.max(0, part.value), 0);

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
        <Block
          title="دارایی‌ها"
          total={assets.total}
          rows={assetBreakdown.map((part) => ({ label: part.name, value: part.value }))}
        />
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
