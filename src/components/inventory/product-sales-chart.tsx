'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SectionCard } from '@/components/dashboard/section-card';

interface ProductSalesChartProps {
  salesHistory: Array<{
    month: string;
    units: number;
    /** Absent without sales.view. */
    revenue?: number;
  }>;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const INDIGO = '#353DB2';
const INDIGO_LIGHT = '#A9AEDE';

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** The months are Jalali months in Tehran, "YYYY-MM" in Latin digits (getProductSalesHistory): 1405-07 is مهر ۱۴۰۵. */
const monthLabel = (key: string) => {
  const month = Number(key.split('-')[1]);
  return JALALI_MONTHS[month - 1] ?? key;
};
const monthRange = (key: string) => {
  const year = Number(key.split('-')[0]);
  return `${monthLabel(key)} ${new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(year)}`;
};

/** Units sold per month over the last 12 months, and the money for sales viewers: indigo bars on hairline gridlines. */
export function ProductSalesChart({ salesHistory }: ProductSalesChartProps) {
  const showRevenue = salesHistory.some((month) => month.revenue !== undefined);
  const units = salesHistory.reduce((sum, month) => sum + month.units, 0);

  return (
    <SectionCard
      title="روند فروش"
      count="۱۲ ماه اخیر"
      aside={
        <span className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: INDIGO }} />
            تعداد ({fa(units)} عدد)
          </span>
          {showRevenue && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: INDIGO_LIGHT }} />
              درآمد (میلیون تومان)
            </span>
          )}
        </span>
      }
    >
      {/* Laid out left to right, so SVG axis labels anchor on the right side; the axis is reversed so the months still run right to left. */}
      <div dir="ltr">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={salesHistory} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="#E3E3E3" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={monthLabel}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={false}
            tickLine={false}
            reversed
          />
          <YAxis
            yAxisId="units"
            orientation="right"
            allowDecimals={false}
            tickFormatter={(value) => fa(value)}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          {showRevenue && (
            <YAxis
              yAxisId="revenue"
              orientation="left"
              tickFormatter={(value) => fa(value / 1_000_000)}
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
          )}
          <Tooltip
            cursor={{ fill: 'rgba(53,61,178,.04)' }}
            formatter={(value: number, name: string) => {
              if (name === 'units') return [`${fa(value)} عدد`, 'تعداد'];
              if (name === 'revenue') return [`${fa(value)} تومان`, 'درآمد'];
              return [value, name];
            }}
            labelFormatter={(label) => monthRange(String(label))}
            contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit', direction: 'rtl' }}
          />
          <Bar yAxisId="units" dataKey="units" name="units" fill={INDIGO} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          {showRevenue && (
            <Bar yAxisId="revenue" dataKey="revenue" name="revenue" fill={INDIGO_LIGHT} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
