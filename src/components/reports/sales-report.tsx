'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Receipt, ShoppingCart, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { DAY, jalaliFull, jalaliShort } from './report-window';
import { axisMoney } from './sales-overview';

interface SalesData {
  /** Revenue and orders per day, or per week for a range longer than 5 weeks. */
  trend: Array<{
    at: number;
    revenue: number;
    orders: number;
    bucketDays: 1 | 7;
  }>;
  salesByProduct: Array<{
    name: string;
    quantity: number;
    revenue: number;
  }>;
  salesByCustomer: Array<{
    name: string;
    orderCount: number;
    revenue: number;
  }>;
}

interface SalesReportProps {
  data: SalesData;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const INDIGO = '#353DB2';

export function SalesReport({ data }: SalesReportProps) {
  const { trend, salesByProduct, salesByCustomer } = data;

  const topProducts = salesByProduct.slice(0, 10);
  const topCustomers = salesByCustomer.slice(0, 10);

  const totalRevenue = trend.reduce((sum, item) => sum + item.revenue, 0);
  const totalOrders = trend.reduce((sum, item) => sum + item.orders, 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const weekly = trend[0]?.bucketDays === 7;
  const bestProduct = Math.max(1, ...topProducts.map((p) => p.revenue));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="فروش کل" icon={Wallet} value={fa(totalRevenue)} unit="تومان" note="بدون سفارش‌های لغوشده" />
        <KpiCard label="تعداد سفارش" icon={ShoppingCart} value={fa(totalOrders)} />
        <KpiCard label="میانگین ارزش سفارش" icon={Receipt} value={fa(avgOrderValue)} unit="تومان" />
      </div>

      <SectionCard title="روند فروش" count={weekly ? 'هفتگی' : 'روزانه'}>
        {totalOrders === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            در این بازه فروشی ثبت نشده است. بازهٔ دیگری را انتخاب کنید.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trend} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#E3E3E3" vertical={false} />
              <XAxis
                dataKey="at"
                tickFormatter={(at: number) => jalaliShort(at)}
                tick={{ fontSize: 11, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
                reversed
                minTickGap={20}
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
                labelFormatter={(at) =>
                  weekly
                    ? `هفتهٔ ${jalaliShort(Number(at))} تا ${jalaliShort(Number(at) + 6 * DAY)}`
                    : jalaliFull(Number(at))
                }
                formatter={(value, _name, item) => [
                  `${fa(Number(value))} تومان · ${fa((item?.payload as { orders?: number })?.orders ?? 0)} سفارش`,
                  'فروش',
                ]}
                contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit' }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={INDIGO}
                strokeWidth={1.75}
                fill={INDIGO}
                fillOpacity={0.08}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="محصولات پرفروش" count="۱۰ محصول برتر">
          {topProducts.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">در این بازه محصولی فروخته نشده است.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-y">
                    <th className="h-9 w-10 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">#</th>
                    <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">محصول</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">تعداد</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">فروش (تومان)</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, index) => (
                    <tr key={`${product.name}-${index}`} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                      <td className="px-3">
                        <span
                          className={`grid h-6 w-6 place-items-center rounded font-mono text-[11px] ${index < 3 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground'}`}
                        >
                          {fa(index + 1)}
                        </span>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="مشتریان برتر" count="۱۰ مشتری برتر">
          {topCustomers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">در این بازه سفارشی ثبت نشده است.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-y">
                    <th className="h-9 w-10 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">#</th>
                    <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">مشتری</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">سفارش</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">فروش (تومان)</th>
                    <th className="hidden h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground sm:table-cell">
                      میانگین (تومان)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((customer, index) => (
                    <tr key={`${customer.name}-${index}`} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                      <td className="px-3">
                        <span
                          className={`grid h-6 w-6 place-items-center rounded font-mono text-[11px] ${index < 3 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground'}`}
                        >
                          {fa(index + 1)}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-3">{customer.name}</td>
                      <td className="px-3 text-end tabular-nums">{fa(customer.orderCount)}</td>
                      <td className="px-3 text-end font-medium tabular-nums">{fa(customer.revenue)}</td>
                      <td className="hidden px-3 text-end tabular-nums text-muted-foreground sm:table-cell">
                        {fa(customer.orderCount ? customer.revenue / customer.orderCount : 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
