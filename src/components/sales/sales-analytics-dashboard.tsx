'use client';

import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Receipt, ShoppingCart, Users, Wallet } from 'lucide-react';
import { KpiCard, type KpiTone } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { axisMoney } from '@/components/reports/sales-overview';

interface SalesAnalyticsData {
  summary: {
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    revenueGrowth: number;
    ordersGrowth: number;
  };
  salesOverTime: Array<{
    date: string;
    dateFormatted: string;
    revenue: number;
    orders: number;
  }>;
  topProducts: Array<{
    id: string;
    name: string;
    quantity: number;
    revenue: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    orders: number;
    revenue: number;
  }>;
  categoryDistribution: Array<{
    type: string;
    revenue: number;
    quantity: number;
  }>;
  forecast: Array<{
    date: string;
    dateFormatted: string;
    revenue: number;
    orders: number;
    isForecast: boolean;
  }>;
}

interface SalesAnalyticsDashboardProps {
  data: SalesAnalyticsData;
}

/** The chart series, indigo first (design system §12): no second hue. */
const SERIES = ['#353DB2', '#7C82D0', '#A9AEDE', '#2D333D'];
const INDIGO = '#353DB2';
const INDIGO_LIGHT = '#7C82D0';

const getCategoryLabel = (type: string) => {
  const labels: Record<string, string> = {
    SALEABLE: 'قابل فروش',
    FIXED_ASSET: 'دارایی ثابت',
    CONSUMABLE: 'مصرفی',
  };
  return labels[type] || type;
};

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
const fa1 = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(n);

/** A growth figure as a pill. The action reports 0 when there was no earlier period, so 0 shows nothing. */
function growth(value: number): { text: string; tone: KpiTone } | undefined {
  if (!value) return undefined;
  return { text: `${value > 0 ? '+' : ''}${fa1(value)}٪`, tone: value > 0 ? 'pos' : 'neg' };
}

const TH = 'h-9 bg-secondary px-3 text-xs font-normal text-muted-foreground';

function Rank({ index }: { index: number }) {
  return (
    <span
      className={`grid h-6 w-6 place-items-center rounded font-mono text-[11px] ${index < 3 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground'}`}
    >
      {fa(index + 1)}
    </span>
  );
}

export function SalesAnalyticsDashboard({ data }: SalesAnalyticsDashboardProps) {
  const { summary, salesOverTime, topProducts, topCustomers, categoryDistribution, forecast } = data;

  // Actual sales, then the forecast as its own dashed line starting from the last actual day.
  const last = salesOverTime[salesOverTime.length - 1];
  const combinedSalesData: Array<{ dateFormatted: string; revenue?: number; forecast?: number; orders?: number }> = [
    ...salesOverTime.map((day) => ({
      dateFormatted: day.dateFormatted,
      revenue: day.revenue,
      orders: day.orders,
      ...(forecast.length > 0 && day === last ? { forecast: day.revenue } : {}),
    })),
    ...forecast.map((day) => ({ dateFormatted: day.dateFormatted, forecast: day.revenue, orders: day.orders })),
  ];

  const revenueGrowth = growth(summary.revenueGrowth);
  const ordersGrowth = growth(summary.ordersGrowth);
  const bestProduct = Math.max(1, ...topProducts.map((p) => p.revenue));
  const categoryTotal = categoryDistribution.reduce((sum, c) => sum + c.revenue, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="کل فروش"
          icon={Wallet}
          value={fa(summary.totalRevenue)}
          unit="تومان"
          delta={revenueGrowth}
          note={revenueGrowth ? 'نسبت به دوره قبل' : 'سفارش‌های تکمیل و تحویل‌شده'}
        />
        <KpiCard
          label="تعداد سفارشات"
          icon={ShoppingCart}
          value={fa(summary.totalOrders)}
          delta={ordersGrowth}
          note={ordersGrowth ? 'نسبت به دوره قبل' : undefined}
        />
        <KpiCard label="میانگین فروش" icon={Receipt} value={fa(summary.averageOrderValue)} unit="تومان" note="میانگین هر سفارش" />
        <KpiCard
          label="مشتریان فعال"
          icon={Users}
          value={fa(topCustomers.length)}
          // The action returns the top ten customers only, so ten means ten or more.
          note={topCustomers.length >= 10 ? 'دست‌کم؛ فقط ۱۰ مشتری برتر شمرده می‌شود' : 'در این دوره'}
        />
      </div>

      <SectionCard
        title="روند فروش و پیش‌بینی"
        count="۹۰ روز گذشته"
        aside={
          <span className="flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" x2="18" y1="3" y2="3" stroke={INDIGO} strokeWidth="2" />
              </svg>
              فروش واقعی
            </span>
            {forecast.length > 0 && (
              <span className="flex items-center gap-1.5">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" x2="18" y1="3" y2="3" stroke={INDIGO_LIGHT} strokeWidth="1.75" strokeDasharray="4 3" />
                </svg>
                پیش‌بینی
              </span>
            )}
          </span>
        }
      >
        {salesOverTime.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">در ۹۰ روز گذشته سفارش تکمیل‌شده‌ای ثبت نشده است.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={combinedSalesData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#E3E3E3" vertical={false} />
              <XAxis
                dataKey="dateFormatted"
                tick={{ fontSize: 11, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
                reversed
                minTickGap={24}
              />
              <YAxis
                orientation="right"
                tickFormatter={axisMoney}
                tick={{ fontSize: 11, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip
                formatter={(value, name) => [`${fa(Number(value))} تومان`, name === 'forecast' ? 'پیش‌بینی' : 'فروش']}
                contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit' }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="revenue"
                stroke={INDIGO}
                strokeWidth={1.75}
                fill={INDIGO}
                fillOpacity={0.08}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="forecast"
                stroke={INDIGO_LIGHT}
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-[12.5px] text-muted-foreground">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] text-brand">پیش‌بینی ۷ روز آینده</span>
          {forecast.length > 0 ? (
            <span>
              بر اساس میانگین فروش ۷ روز گذشته، فروش روزانه حدود{' '}
              <b className="font-medium text-foreground tabular-nums">{fa(forecast[0]?.revenue || 0)} تومان</b> پیش‌بینی
              می‌شود.
            </span>
          ) : (
            <span>برای پیش‌بینی دست‌کم ۷ روزِ دارای فروش لازم است.</span>
          )}
        </p>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="محصولات پرفروش" count="۱۰ محصول برتر بر اساس درآمد">
            {topProducts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">در این دوره محصولی فروخته نشده است.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-y">
                      <th className={`${TH} w-10 text-start`}>#</th>
                      <th className={`${TH} text-start`}>نام محصول</th>
                      <th className={`${TH} text-end`}>تعداد فروش</th>
                      <th className={`${TH} text-end`}>کل درآمد (تومان)</th>
                      <th className={`${TH} hidden text-end sm:table-cell`}>قیمت میانگین (تومان)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, index) => (
                      <tr key={product.id} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                        <td className="px-3">
                          <Rank index={index} />
                        </td>
                        <td className="max-w-[220px] px-3">
                          <span className="block truncate font-mono text-[12.5px]">
                            <bdi>{product.name}</bdi>
                          </span>
                          <span className="mt-1 block h-1 w-full max-w-[160px] bg-secondary">
                            <span className="block h-full bg-brand" style={{ width: `${(product.revenue / bestProduct) * 100}%` }} />
                          </span>
                        </td>
                        <td className="px-3 text-end tabular-nums">{fa(product.quantity)}</td>
                        <td className="px-3 text-end font-medium tabular-nums">{fa(product.revenue)}</td>
                        <td className="hidden px-3 text-end tabular-nums text-muted-foreground sm:table-cell">
                          {fa(product.quantity ? product.revenue / product.quantity : 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard title="توزیع فروش بر اساس نوع محصول" count="سهم از درآمد">
          {categoryDistribution.length === 0 || categoryTotal === 0 ? (
            <p className="text-[13px] text-muted-foreground">در این دوره فروشی ثبت نشده است.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categoryDistribution}
                    dataKey="revenue"
                    nameKey="type"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={84}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {categoryDistribution.map((entry, index) => (
                      <Cell key={entry.type} fill={SERIES[index % SERIES.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${fa(Number(value))} تومان`, getCategoryLabel(String(name))]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 divide-y">
                {categoryDistribution.map((entry, index) => (
                  <div key={entry.type} className="flex items-center gap-2.5 py-2 text-[12.5px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: SERIES[index % SERIES.length] }} />
                    <span className="flex-1">{getCategoryLabel(entry.type)}</span>
                    <span className="text-muted-foreground tabular-nums">{fa(entry.revenue)}</span>
                    <span className="w-12 text-end font-medium tabular-nums">{fa1((entry.revenue / categoryTotal) * 100)}٪</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>
      </div>

      <SectionCard title="مشتریان برتر" count="۱۰ مشتری برتر بر اساس درآمد">
        {topCustomers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">در این دوره سفارشی ثبت نشده است.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y">
                  <th className={`${TH} w-10 text-start`}>رتبه</th>
                  <th className={`${TH} text-start`}>نام مشتری</th>
                  <th className={`${TH} text-end`}>تعداد سفارشات</th>
                  <th className={`${TH} text-end`}>کل خرید (تومان)</th>
                  <th className={`${TH} text-end`}>میانگین خرید (تومان)</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((customer, index) => (
                  <tr key={customer.id} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                    <td className="px-3">
                      <Rank index={index} />
                    </td>
                    <td className="max-w-[240px] truncate px-3 font-medium">{customer.name}</td>
                    <td className="px-3 text-end tabular-nums">{fa(customer.orders)}</td>
                    <td className="px-3 text-end font-medium tabular-nums">{fa(customer.revenue)}</td>
                    <td className="px-3 text-end tabular-nums text-muted-foreground">
                      {fa(customer.orders ? customer.revenue / customer.orders : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
