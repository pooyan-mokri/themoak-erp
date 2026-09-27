'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Globe, Receipt, ShoppingCart, Wallet } from 'lucide-react';
import { KpiCard, type KpiTone } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import {
  CHANNEL_LABELS,
  DAY,
  WEEKDAYS,
  jalaliFull,
  jalaliShort,
  type ReportWindow,
  type SalesSummary,
  type TrendPoint,
} from './report-window';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
const fa1 = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(n);
const INDIGO = '#353DB2';
const INDIGO_LIGHT = '#A9AEDE';

/** Axis money: a few digits and a word, never a wall of zeros. */
export function axisMoney(value: number) {
  if (value >= 1e9) return `${fa1(value / 1e9)} میلیارد`;
  if (value >= 1e6) return `${fa1(value / 1e6)} م`;
  if (value >= 1e3) return `${fa(value / 1e3)} هزار`;
  return fa(value);
}

/** The change against the compared period, only when that period had something to compare with. */
function change(current: number, previous: number): { text: string; tone: KpiTone } | undefined {
  if (previous <= 0) return undefined;
  const pct = ((current - previous) / previous) * 100;
  return { text: `${pct > 0 ? '+' : ''}${fa1(pct)}٪`, tone: pct >= 0.05 ? 'pos' : pct <= -0.05 ? 'neg' : 'neu' };
}

/** When a point of the trend starts and ends, in words. */
function spanOf(at: number, bucketDays: number, end: number) {
  if (bucketDays === 1) return jalaliFull(at);
  return `هفتهٔ ${jalaliShort(at)} تا ${jalaliShort(Math.min(at + (bucketDays - 1) * DAY, end))}`;
}

export function SalesOverview({ period: w, summary }: { period: ReportWindow; summary: SalesSummary }) {
  const [compare, setCompare] = useState(true);
  const { totals, trend, heat, channels } = summary;
  const aov = totals.orders ? totals.revenue / totals.orders : 0;
  const prevAov = totals.prevOrders ? totals.prevRevenue / totals.prevOrders : 0;
  const site = channels.find((c) => c.id === 'site');
  const siteShare = totals.revenue ? ((site?.revenue ?? 0) / totals.revenue) * 100 : null;
  const prevSiteShare = totals.prevRevenue ? ((site?.prevRevenue ?? 0) / totals.prevRevenue) * 100 : null;
  const against = (value: string) => (compare ? `در برابر ${value}` : undefined);

  return (
    <div className="space-y-4">
      <label
        className={`flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground ${compare ? '' : 'print:hidden'}`}
      >
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => setCompare(e.target.checked)}
          className="h-4 w-4 accent-[#353DB2] print:hidden"
        />
        مقایسه با {w.prevLabel}
        <span className="text-[11.5px]">
          · <span className="font-mono">{jalaliFull(w.prevStart)}</span> تا <span className="font-mono">{jalaliFull(w.prevEnd)}</span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="فروش دوره"
          icon={Wallet}
          value={totals.revenue ? fa(totals.revenue) : '—'}
          unit={totals.revenue ? 'تومان' : undefined}
          delta={compare ? change(totals.revenue, totals.prevRevenue) : undefined}
          note={against(totals.prevRevenue ? `${fa(totals.prevRevenue)} تومان` : 'بی‌فروش')}
        />
        <KpiCard
          label="سفارش‌ها"
          icon={ShoppingCart}
          value={fa(totals.orders)}
          delta={compare ? change(totals.orders, totals.prevOrders) : undefined}
          note={against(fa(totals.prevOrders))}
        />
        <KpiCard
          label="میانگین سفارش"
          icon={Receipt}
          value={aov ? fa(aov) : '—'}
          unit={aov ? 'تومان' : undefined}
          delta={compare ? change(aov, prevAov) : undefined}
          note={against(prevAov ? fa(prevAov) : '—')}
        />
        <KpiCard
          label="سهم سایت از فروش"
          icon={Globe}
          value={siteShare === null ? '—' : `${fa1(siteShare)}٪`}
          note={
            compare && prevSiteShare !== null
              ? `در برابر ${fa1(prevSiteShare)}٪`
              : `${fa(site?.orders ?? 0)} سفارش از سایت`
          }
        />
      </div>

      <SectionCard
        title={w.bucketDays === 1 ? 'روند فروش روزانه' : 'روند فروش هفتگی'}
        count={w.label}
        aside={
          <span className="flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" x2="18" y1="3" y2="3" stroke={INDIGO} strokeWidth="2" />
              </svg>
              این دوره
            </span>
            {compare && (
              <span className="flex items-center gap-1.5">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" x2="18" y1="3" y2="3" stroke={INDIGO_LIGHT} strokeWidth="1.5" strokeDasharray="4 3" />
                </svg>
                دورهٔ قبل
              </span>
            )}
          </span>
        }
      >
        {totals.orders === 0 && totals.prevOrders === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            در این بازه و دورهٔ قبلش فروشی ثبت نشده است. بازهٔ بلندتری را انتخاب کنید.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
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
                cursor={{ stroke: '#D2D2D2', strokeDasharray: '2 3' }}
                content={<TrendTooltip compare={compare} bucketDays={w.bucketDays} end={w.end} prevEnd={w.prevEnd} />}
              />
              {compare && (
                <Line
                  dataKey="prevRevenue"
                  stroke={INDIGO_LIGHT}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              <Line dataKey="revenue" stroke={INDIGO} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesHeatmap heat={heat} />
        </div>
        <ChannelSplit channels={channels} totals={totals} compare={compare} />
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  compare,
  bucketDays,
  end,
  prevEnd,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  compare: boolean;
  bucketDays: number;
  end: number;
  prevEnd: number;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="min-w-[200px] rounded-lg border bg-card px-3 py-2 text-xs">
      <p className="mb-1 text-muted-foreground">{spanOf(point.at, bucketDays, end)}</p>
      <p className="flex justify-between gap-4">
        <span>{fa(point.orders)} سفارش</span>
        <span className="font-medium tabular-nums">{fa(point.revenue)} تومان</span>
      </p>
      {compare && (
        <>
          <p className="mt-2 mb-1 text-muted-foreground">{spanOf(point.prevAt, bucketDays, prevEnd)}</p>
          <p className="flex justify-between gap-4 text-muted-foreground">
            <span>{fa(point.prevOrders)} سفارش</span>
            <span className="tabular-nums">{fa(point.prevRevenue)} تومان</span>
          </p>
        </>
      )}
    </div>
  );
}

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

/** Orders by Tehran weekday and hour of this period: darker indigo, more orders. */
function SalesHeatmap({ heat }: { heat: SalesSummary['heat'] }) {
  const max = Math.max(0, ...heat.orders.flat());
  let peak: { day: number; hour: number } | null = null;
  heat.orders.forEach((row, day) =>
    row.forEach((n, hour) => {
      if (n > 0 && (!peak || n > heat.orders[peak.day][peak.hour])) peak = { day, hour };
    }),
  );
  const top = peak as { day: number; hour: number } | null;
  const shade = (n: number) => (n === 0 ? undefined : `rgba(53, 61, 178, ${(0.12 + 0.88 * (n / max)).toFixed(2)})`);

  return (
    <SectionCard
      title="ساعت و روز فروش"
      count="ساعت × روز هفته"
      aside={
        top && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] text-brand">
            بیشترین: {WEEKDAYS[top.day]}، ساعت {fa(top.hour)} تا {fa(top.hour + 1)}
          </span>
        )
      }
    >
      {max === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          در این بازه فروشی ثبت نشده است؛ این جدول از ساعت ثبت سفارش‌ها پر می‌شود.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[520px] items-center gap-[3px]"
              style={{ gridTemplateColumns: '58px repeat(24, minmax(0, 1fr)) 40px' }}
            >
              <span />
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} className="text-center text-[10px] tabular-nums text-muted-foreground">
                  {HOUR_LABELS.includes(hour) ? fa(hour) : ''}
                </span>
              ))}
              <span className="text-end text-[10px] text-muted-foreground">جمع</span>
              {heat.orders.map((row, day) => (
                <div key={day} className="contents">
                  <span className="pe-2 text-[11.5px] text-muted-foreground">{WEEKDAYS[day]}</span>
                  {row.map((n, hour) => (
                    <span
                      key={hour}
                      title={`${WEEKDAYS[day]}، ساعت ${fa(hour)} تا ${fa(hour + 1)}: ${fa(n)} سفارش${n ? `، ${fa(heat.revenue[day][hour])} تومان` : ''}`}
                      className="block h-[20px] rounded-[3px] bg-secondary print:border print:border-border"
                      style={{ backgroundColor: shade(n) }}
                    />
                  ))}
                  <span className="text-end text-[11.5px] tabular-nums">{fa(row.reduce((a, b) => a + b, 0))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1 text-[10.5px] text-muted-foreground">
            کم
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((level) => (
              <span
                key={level}
                className="h-3 w-3 rounded-[2px]"
                style={{ backgroundColor: `rgba(53, 61, 178, ${(0.12 + 0.88 * level).toFixed(2)})` }}
              />
            ))}
            زیاد
            <span className="ms-2">· تعداد سفارش، به وقت تهران</span>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/** Site against shop: each source's share of this period's revenue, and of the compared period's. */
function ChannelSplit({
  channels,
  totals,
  compare,
}: {
  channels: SalesSummary['channels'];
  totals: SalesSummary['totals'];
  compare: boolean;
}) {
  const current = channels.filter((c) => c.orders > 0);
  return (
    <SectionCard title="سایت و فروشگاه" count="سهم از فروش">
      {current.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">در این بازه فروشی ثبت نشده است.</p>
      ) : (
        <div className="space-y-4">
          {current.map((c) => {
            const share = totals.revenue ? (c.revenue / totals.revenue) * 100 : 0;
            const prevShare = totals.prevRevenue ? (c.prevRevenue / totals.prevRevenue) * 100 : null;
            return (
              <div key={c.id}>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span>{CHANNEL_LABELS[c.id]}</span>
                  <span className="font-medium tabular-nums">{fa1(share)}٪</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-secondary">
                  <div className="h-full bg-brand" style={{ width: `${share}%` }} />
                </div>
                <div className="mt-1 flex justify-between gap-2 text-[11.5px] text-muted-foreground">
                  <span>
                    {fa(c.orders)} سفارش · {fa(c.revenue)} تومان
                  </span>
                  {compare && prevShare !== null && <span>قبل: {fa1(prevShare)}٪</span>}
                </div>
              </div>
            );
          })}
          <p className="border-t pt-3 text-[11.5px] text-muted-foreground">
            سفارشی که از سایت رسیده «سایت» حساب شده و بقیه «فروشگاه»؛ همان برچسبِ فهرست سفارش‌ها.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
