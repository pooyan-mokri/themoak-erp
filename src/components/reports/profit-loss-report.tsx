'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { KpiCard, type KpiTone } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { cn } from '@/lib/utils';

interface ProfitLossData {
  summary: {
    income: number;
    expenses: number;
    netProfit: number;
    profitMargin: number;
  };
  incomeByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  monthlyTrend: Array<{
    month: string;
    income: number;
    expenses: number;
    profit: number;
  }>;
}

interface ProfitLossReportProps {
  data: ProfitLossData;
  /** The same report for the period before, for the comparison column and the KPI changes. */
  previous?: ProfitLossData;
  periodLabel?: string;
  previousLabel?: string;
  /** Month by month, oldest first, for the chart. The report's own monthlyTrend when left out. */
  trend?: Array<{ label: string; income: number; expenses: number; profit: number }>;
}

const INDIGO = '#353DB2';
const INDIGO_SOFT = '#A9AEDE';
const INK = '#2D333D';

/** Category names as the actions store them, in Persian. Anything else is shown as stored. */
const CATEGORY_LABELS: Record<string, string> = {
  Sales: 'فروش',
  Return: 'مرجوعی',
  Exchange: 'تعویض کالا',
  COGS: 'بهای تمام‌شده کالای فروش‌رفته',
  Salary: 'حقوق',
  Depreciation: 'استهلاک',
  'Purchase Payment': 'پرداخت خرید',
  'Purchase Arrival Cost': 'هزینه حمل و ورود خرید',
  'Marketing/Gift': 'هدیه بازاریابی',
  'Marketing - Gift': 'هدیه بازاریابی',
  'Loan Payment': 'بازپرداخت قرض',
  'Currency Exchange': 'معامله ارز',
  'Shareholder Deposit': 'واریز سرمایه سهامدار',
  'Shareholder Withdrawal': 'برداشت سرمایه سهامدار',
  'Shareholder Profit Withdrawal': 'برداشت سود سهامدار',
  CONSIGNMENT_COMMISSION: 'کمیسیون فروش امانی',
  Other: 'سایر',
};
const labelOf = (category: string) => CATEGORY_LABELS[category] ?? category;

const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${fa(n, digits)}`;

/** Change from `before` to `now` in percent; null when there is nothing to compare with. */
const changeOf = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

function Delta({ now, before }: { now: number; before: number }) {
  const change = changeOf(now, before);
  if (change === null) return <span className="text-muted-foreground">{now ? 'جدید' : '—'}</span>;
  return <span dir="ltr">{signed(change)}٪</span>;
}

/**
 * One statement line: current, previous, change and its share of revenue.
 * A cost line is given as a positive amount and shown in parentheses, so its
 * change reads as the cost rising or falling.
 */
function Line({
  label,
  now,
  before,
  revenue,
  hasPrevious,
  cost = false,
  level = 'row',
}: {
  label: string;
  now: number;
  before: number;
  revenue: number;
  hasPrevious: boolean;
  cost?: boolean;
  level?: 'row' | 'total' | 'grand';
}) {
  const share = revenue > 0 ? (Math.abs(now) / revenue) * 100 : null;
  const amount = (n: number) => (n !== 0 && (cost || n < 0) ? `(${fa(Math.abs(n))})` : fa(n));
  return (
    <tr
      className={cn(
        'h-11 border-b transition-colors duration-150 hover:bg-brand/[.04]',
        level === 'total' && 'bg-secondary font-medium',
        level === 'grand' && 'bg-brand-soft font-medium text-brand hover:bg-brand-soft',
      )}
    >
      <td className={cn('px-4', level === 'row' && 'ps-8 text-muted-foreground')}>{label}</td>
      <td className="px-3 text-end tabular-nums">{amount(now)}</td>
      {hasPrevious && <td className="px-3 text-end tabular-nums text-muted-foreground">{amount(before)}</td>}
      {hasPrevious && (
        <td className="px-3 text-end tabular-nums">
          <Delta now={now} before={before} />
        </td>
      )}
      <td className="px-4">
        {share === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-[120px] overflow-hidden rounded bg-secondary">
              <span className="block h-full" style={{ width: `${Math.min(100, share)}%`, background: level === 'row' ? INDIGO_SOFT : INDIGO }} />
            </div>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">{fa(share)}٪</span>
          </div>
        )}
      </td>
    </tr>
  );
}

export function ProfitLossReport({ data, previous, periodLabel, previousLabel, trend }: ProfitLossReportProps) {
  const { summary } = data;
  const before = previous?.summary;
  const hasPrevious = !!previous;

  const tone = (now: number, prev: number | undefined, upIsGood: boolean): { text: string; tone: KpiTone } | undefined => {
    if (prev === undefined) return undefined;
    const change = changeOf(now, prev);
    if (change === null) return undefined;
    const good = upIsGood ? change > 0 : change < 0;
    return { text: `${signed(change)}٪`, tone: change === 0 ? 'neu' : good ? 'pos' : 'neg' };
  };
  const vsPrevious = previousLabel ? `نسبت به ${previousLabel}` : undefined;

  // Every category in either period, the larger ones first.
  const lines = (now: Record<string, number>, prev: Record<string, number> = {}) =>
    Array.from(new Set([...Object.keys(now), ...Object.keys(prev)]))
      .map((category) => ({ category, now: now[category] ?? 0, before: prev[category] ?? 0 }))
      .sort((a, b) => b.now - a.now || b.before - a.before);
  const incomeLines = lines(data.incomeByCategory, previous?.incomeByCategory);
  const expenseLines = lines(data.expensesByCategory, previous?.expensesByCategory);

  const chart =
    trend ??
    data.monthlyTrend.map((m) => ({ label: m.month, income: m.income, expenses: m.expenses, profit: m.profit }));
  const marginChange = before && before.income > 0 && summary.income > 0 ? summary.profitMargin - before.profitMargin : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="درآمد کل"
          value={fa(summary.income)}
          unit="تومان"
          delta={tone(summary.income, before?.income, true)}
          note={vsPrevious}
        />
        <KpiCard
          label="هزینه کل"
          value={fa(summary.expenses)}
          unit="تومان"
          delta={tone(summary.expenses, before?.expenses, false)}
          note={vsPrevious}
        />
        <KpiCard
          label={summary.netProfit < 0 ? 'زیان خالص' : 'سود خالص'}
          value={fa(Math.abs(summary.netProfit))}
          unit="تومان"
          delta={tone(summary.netProfit, before?.netProfit, true)}
          note={vsPrevious}
        />
        <KpiCard
          label="حاشیه سود"
          value={summary.income > 0 ? `${fa(summary.profitMargin, 1)}٪` : '—'}
          delta={
            marginChange === null
              ? undefined
              : { text: `${signed(marginChange)} واحد`, tone: marginChange > 0 ? 'pos' : marginChange < 0 ? 'neg' : 'neu' }
          }
          note={summary.income > 0 ? vsPrevious : 'در این دوره درآمدی ثبت نشده'}
        />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h3 className="text-sm font-medium">صورت سود و زیان{periodLabel ? ` · ${periodLabel}` : ''}</h3>
          <span className="text-[12px] text-muted-foreground">مبلغ‌ها به تومان · سهم هر ردیف از درآمد کل دوره</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-y">
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">شرح</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">{periodLabel ?? 'این دوره'}</th>
                {hasPrevious && (
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">{previousLabel ?? 'دوره قبل'}</th>
                )}
                {hasPrevious && <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">تغییر</th>}
                <th className="h-9 w-[190px] bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">سهم از درآمد</th>
              </tr>
            </thead>
            <tbody>
              {incomeLines.map((line) => (
                <Line
                  key={`in-${line.category}`}
                  label={labelOf(line.category)}
                  now={line.now}
                  before={line.before}
                  revenue={summary.income}
                  hasPrevious={hasPrevious}
                />
              ))}
              <Line label="جمع درآمد" now={summary.income} before={before?.income ?? 0} revenue={summary.income} hasPrevious={hasPrevious} level="total" />
              {expenseLines.map((line) => (
                <Line
                  key={`out-${line.category}`}
                  label={labelOf(line.category)}
                  now={line.now}
                  before={line.before}
                  revenue={summary.income}
                  hasPrevious={hasPrevious}
                  cost
                />
              ))}
              <Line
                label="جمع هزینه‌ها"
                now={summary.expenses}
                before={before?.expenses ?? 0}
                revenue={summary.income}
                hasPrevious={hasPrevious}
                cost
                level="total"
              />
              <Line
                label="سود (زیان) خالص"
                now={summary.netProfit}
                before={before?.netProfit ?? 0}
                revenue={summary.income}
                hasPrevious={hasPrevious}
                level="grand"
              />
            </tbody>
          </table>
        </div>
        {incomeLines.length === 0 && expenseLines.length === 0 && (
          <p className="border-t px-4 py-6 text-center text-[13px] text-muted-foreground">
            در این دوره تراکنشی ثبت نشده است. دوره دیگری را از بالای صفحه انتخاب کنید.
          </p>
        )}
      </div>

      <SectionCard title="روند ماهانه" count={chart.length ? `${fa(chart.length)} ماه` : undefined} aside={<span className="text-muted-foreground">درآمد و هزینه به تفکیک ماه</span>}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#E3E3E3" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="label" reversed tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <YAxis
              orientation="right"
              tickFormatter={(value) => `${fa(value / 1_000_000)} م`}
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              formatter={(value) => `${fa(Number(value))} تومان`}
              labelStyle={{ direction: 'rtl' }}
              contentStyle={{ borderRadius: 8, border: '1px solid #E3E3E3', fontSize: 12, fontFamily: 'inherit' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" fill={INDIGO} name="درآمد" radius={[2, 2, 0, 0]} />
            <Bar dataKey="expenses" fill={INDIGO_SOFT} name="هزینه" radius={[2, 2, 0, 0]} />
            <Bar dataKey="profit" fill={INK} name="سود" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  );
}
