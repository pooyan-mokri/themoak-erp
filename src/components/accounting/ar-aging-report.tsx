'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { LegendItem, SERIES, StackBar, fa } from './finance-bits';

interface ARAgingBucket {
  customerName: string;
  totalDue: number;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days90Plus: number;
}

interface ARAgingReportProps {
  data: ARAgingBucket[];
}

type BucketKey = 'current' | 'days1_30' | 'days31_60' | 'days61_90' | 'days90Plus';

/** The five age buckets, youngest first, each with its colour in the mix bars. */
const BUCKETS: Array<{ key: BucketKey; label: string; color: string }> = [
  { key: 'current', label: 'جاری', color: SERIES[0] },
  { key: 'days1_30', label: '۱ تا ۳۰ روز', color: SERIES[1] },
  { key: 'days31_60', label: '۳۱ تا ۶۰ روز', color: SERIES[2] },
  { key: 'days61_90', label: '۶۱ تا ۹۰ روز', color: SERIES[4] },
  { key: 'days90Plus', label: 'بیش از ۹۰ روز', color: SERIES[3] },
];

type SortKey = 'customerName' | 'totalDue' | BucketKey;

export function ARAgingReport({ data }: ARAgingReportProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'totalDue', dir: 'desc' });

  const totals = data.reduce((acc, curr) => ({
    totalDue: acc.totalDue + curr.totalDue,
    current: acc.current + curr.current,
    days1_30: acc.days1_30 + curr.days1_30,
    days31_60: acc.days31_60 + curr.days31_60,
    days61_90: acc.days61_90 + curr.days61_90,
    days90Plus: acc.days90Plus + curr.days90Plus,
  }), {
    totalDue: 0,
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    days90Plus: 0,
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? data.filter((row) => row.customerName.toLowerCase().includes(q)) : data;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === 'string' ? x.localeCompare(y as string, 'fa') : (x as number) - (y as number)) * dir;
    });
  }, [data, query, sort]);

  const share = (value: number) => (totals.totalDue > 0 ? (value / totals.totalDue) * 100 : 0);
  const overdue90 = data.filter((row) => row.days90Plus > 0).length;

  const SortHead = ({ k, children, end }: { k: SortKey; children: React.ReactNode; end?: boolean }) => (
    <th className={cn('h-9 bg-secondary px-3 text-xs font-normal text-muted-foreground', end ? 'text-end' : 'text-start')}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.key === k && (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="حساب‌های دریافتنی"
        description={
          data.length
            ? `${fa(totals.totalDue)} تومان طلب از ${fa(data.length)} مشتری · ${fa(share(totals.days90Plus))}٪ بیش از ۹۰ روز`
            : 'گزارش سنی طلب از مشتریان'
        }
      />

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">گزارش سنی مطالبات</h3>
          <span className="text-[12px] text-muted-foreground">
            مانده سفارش‌های پرداخت‌نشده، بر اساس روزهای گذشته از ثبت سفارش
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {BUCKETS.map((bucket) => (
            <div key={bucket.key}>
              <p className="text-xs text-muted-foreground">{bucket.label}</p>
              <p className="mt-1 text-[19px] font-medium tabular-nums">
                {fa(totals[bucket.key])}
                <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary">
                <span className="block h-full" style={{ width: `${share(totals[bucket.key])}%`, background: bucket.color }} />
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{fa(share(totals[bucket.key]))}٪ از کل</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {BUCKETS.map((bucket) => (
            <LegendItem key={bucket.key} color={bucket.color}>
              {bucket.label}
            </LegendItem>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="نام مشتری" className="ps-8" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <SortHead k="customerName">مشتری</SortHead>
                <SortHead k="totalDue" end>
                  کل بدهی (تومان)
                </SortHead>
                <th className="h-9 w-[140px] bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">ترکیب سنی</th>
                {BUCKETS.map((bucket) => (
                  <SortHead key={bucket.key} k={bucket.key} end>
                    {bucket.label}
                  </SortHead>
                ))}
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                    طلبی از مشتریان نیست: همه سفارش‌های ثبت‌شده به نام مشتری پرداخت شده‌اند.
                  </td>
                </tr>
              ) : (
                <>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="h-20 px-4 text-center text-[13px] text-muted-foreground">
                        مشتری‌ای با این نام در گزارش نیست.{' '}
                        <button className="text-brand hover:underline" onClick={() => setQuery('')}>
                          نمایش همه
                        </button>
                      </td>
                    </tr>
                  )}
                  {rows.map((row, index) => (
                    <tr key={`${row.customerName}-${index}`} className="h-11 border-b transition-colors duration-150 hover:bg-brand/[.04]">
                      <td className="max-w-[200px] truncate px-3 font-medium">{row.customerName}</td>
                      <td className="px-3 text-end font-medium tabular-nums">{fa(row.totalDue)}</td>
                      <td className="px-3">
                        <StackBar
                          className="h-1.5 w-[120px]"
                          parts={BUCKETS.map((bucket) => ({
                            key: bucket.key,
                            value: row[bucket.key],
                            color: bucket.color,
                            title: `${bucket.label}: ${fa(row[bucket.key])}`,
                          }))}
                        />
                      </td>
                      {BUCKETS.map((bucket) => (
                        <td key={bucket.key} className="px-3 text-end tabular-nums text-muted-foreground">
                          {row[bucket.key] ? fa(row[bucket.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-3">
                        {row.days90Plus > 0 ? (
                          <span className="whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">
                            معوق بیش از ۹۰ روز
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {data.length > 0 && (
              <tfoot>
                <tr className="h-11 border-t bg-secondary font-medium">
                  <td className="px-3">جمع کل</td>
                  <td className="px-3 text-end tabular-nums">{fa(totals.totalDue)}</td>
                  <td className="px-3">
                    <StackBar
                      className="h-1.5 w-[120px]"
                      parts={BUCKETS.map((bucket) => ({ key: bucket.key, value: totals[bucket.key], color: bucket.color }))}
                    />
                  </td>
                  {BUCKETS.map((bucket) => (
                    <td key={bucket.key} className="px-3 text-end tabular-nums">
                      {fa(totals[bucket.key])}
                    </td>
                  ))}
                  <td className="px-3 text-[12px] font-normal text-muted-foreground">
                    {overdue90 ? `${fa(overdue90)} مشتری معوق` : ''}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
