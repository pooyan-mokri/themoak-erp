'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tomanTick } from '@/lib/chart-format';
import { formatJalaliDate } from '@/lib/date-utils';
import { SectionCard } from './section-card';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const INDIGO = '#353DB2';

/** Daily sales over the last 30 days: one indigo series on hairline gridlines. */
export function SalesChart({
  dailySales,
  reportHref,
}: {
  dailySales: Array<{ date: string; total: number; count: number }>;
  reportHref?: string;
}) {
  const total = dailySales.reduce((sum, day) => sum + day.total, 0);
  return (
    <SectionCard
      title="روند فروش"
      count="۳۰ روز اخیر"
      aside={<span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] text-brand">جمع کل {fa(total)} تومان</span>}
      link={reportHref ? { href: reportHref, label: 'گزارش کامل ←' } : undefined}
    >
      {/* Laid out left to right, so SVG axis labels anchor on the right side; the axis is reversed so time still runs right to left. */}
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={dailySales} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#E3E3E3" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => formatJalaliDate(new Date(value), 'jMM/jDD')}
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={false}
              tickLine={false}
              reversed
              minTickGap={24}
            />
            <YAxis
              orientation="right"
              tickFormatter={tomanTick}
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={false}
              tickLine={false}
              width={80}
            />
            <Tooltip
              formatter={(value: number) => [`${fa(value)} تومان`, 'فروش']}
              labelFormatter={(label) => formatJalaliDate(new Date(label))}
              contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit', direction: 'rtl' }}
            />
            <Area type="monotone" dataKey="total" stroke={INDIGO} strokeWidth={1.75} fill={INDIGO} fillOpacity={0.08} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
