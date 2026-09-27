'use client';

import { useMemo, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { ArrowLeftRight } from 'lucide-react';
import { setExchangeRate } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { SectionCard } from '@/components/dashboard/section-card';
import { Currency } from '@/lib/types';
import { formatJalaliDate, formatJalaliDateTime } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { CURRENCY_NAMES, Sparkline, fa } from './finance-bits';

const initialState = {
  message: '',
  errors: {},
};

/** The currencies a rate can be recorded for: the foreign ones the ERP keeps accounts in. */
const RATE_CURRENCIES = [Currency.USD, Currency.EUR, Currency.CNY];

const DAY = 24 * 60 * 60 * 1000;
/** Points drawn in a row's sparkline: its most recent rates. */
const SPARK_POINTS = 12;

type Rate = { id: string; currency: string; rateToToman: number; date: Date | string };

const rateText = (n: number) => fa(n, 2);

/**
 * The reference rate of each foreign currency in Toman. There is one rate per
 * currency (no buy/sell spread); every recorded rate is kept as its history.
 */
export function ExchangeRateManager({ rates, canManage = false }: { rates: Rate[]; canManage?: boolean }) {
  const [state, dispatch] = useFormState(setExchangeRate, initialState);
  const [formCurrency, setFormCurrency] = useState<string>('');
  const rateInput = useRef<HTMLInputElement>(null);

  // rates arrive newest first; per currency, its rows oldest first.
  const byCurrency = useMemo(() => {
    const map = new Map<string, Rate[]>();
    for (const rate of [...rates].reverse()) {
      if (!map.has(rate.currency)) map.set(rate.currency, []);
      map.get(rate.currency)!.push(rate);
    }
    return map;
  }, [rates]);

  const now = Date.now();
  const rows = RATE_CURRENCIES.filter((c) => byCurrency.has(c)).map((currency) => {
    const history = byCurrency.get(currency)!;
    const latest = history[history.length - 1];
    // The rate in force a week ago: the last one recorded on or before that day.
    const weekAgo = [...history].reverse().find((r) => new Date(r.date).getTime() <= now - 7 * DAY);
    const change = weekAgo && weekAgo.rateToToman > 0 ? ((latest.rateToToman - weekAgo.rateToToman) / weekAgo.rateToToman) * 100 : null;
    return { currency, latest, change, spark: history.slice(-SPARK_POINTS).map((r) => r.rateToToman), count: history.length };
  });
  const missing = RATE_CURRENCIES.filter((c) => !byCurrency.has(c));
  const lastRecorded = rates[0];

  // The history table: each rate beside the one recorded before it for the same currency.
  const history = useMemo(() => {
    const previous = new Map<string, number>();
    const withChange = [...rates].reverse().map((rate) => {
      const before = previous.get(rate.currency);
      previous.set(rate.currency, rate.rateToToman);
      return { ...rate, change: before ? ((rate.rateToToman - before) / before) * 100 : null };
    });
    return withChange.reverse();
  }, [rates]);

  // Converter: an amount of a currency to Toman at its latest rate, or back.
  const [pickedCurrency, setCalcCurrency] = useState<string>(rows[0]?.currency ?? '');
  // The first currency that has a rate, until one is picked (or when the picked one has none).
  const calcCurrency = rows.some((r) => r.currency === pickedCurrency) ? pickedCurrency : rows[0]?.currency ?? '';
  const [calcAmount, setCalcAmount] = useState('1000');
  const [toToman, setToToman] = useState(true);
  const calcRate = rows.find((r) => r.currency === calcCurrency)?.latest.rateToToman ?? 0;
  const amount = Number(calcAmount) || 0;
  const converted = calcRate > 0 ? (toToman ? amount * calcRate : amount / calcRate) : 0;

  const startNewRate = (currency: string) => {
    setFormCurrency(currency);
    rateInput.current?.focus();
  };

  const succeeded = state.message?.includes('موفقیت');

  return (
    <div className="space-y-4">
      <PageHeader
        title="نرخ ارز"
        description={
          lastRecorded
            ? `نرخ مرجع هر ارز به تومان، برای ثبت و ارزش‌گذاری تراکنش‌های ارزی · آخرین ثبت ${formatJalaliDateTime(lastRecorded.date)}`
            : 'نرخ مرجع هر ارز به تومان، برای ثبت و ارزش‌گذاری تراکنش‌های ارزی'
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
              <h3 className="text-sm font-medium">آخرین نرخ هر ارز</h3>
              <span className="text-[12px] text-muted-foreground">یک نرخ برای هر ارز؛ خرید و فروش جدا ندارد</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-y">
                    <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">ارز</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">نرخ (تومان)</th>
                    <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">تغییر ۷ روز</th>
                    <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">روند</th>
                    <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">آخرین ثبت</th>
                    {canManage && <th className="h-9 bg-secondary px-3" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                        هنوز نرخی ثبت نشده است. {canManage ? 'نرخ هر ارز را از فرم «ثبت نرخ» وارد کنید؛' : ''} بدون نرخ، تراکنش ارزی به تومان
                        ارزش‌گذاری نمی‌شود.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.currency} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                      <td className="px-4">
                        <span className="font-medium">{CURRENCY_NAMES[row.currency]}</span>{' '}
                        <span className="font-mono text-[11.5px] text-muted-foreground">{row.currency}</span>
                      </td>
                      <td className="px-3 text-end font-medium tabular-nums">{rateText(row.latest.rateToToman)}</td>
                      <td className="px-3 text-end tabular-nums text-muted-foreground" dir="ltr">
                        {row.change === null ? (
                          <span title="نرخی از یک هفته پیش ثبت نشده است">—</span>
                        ) : (
                          `${row.change > 0 ? '+' : ''}${fa(row.change, 1)}٪`
                        )}
                      </td>
                      <td className="px-3">
                        <Sparkline values={row.spark} />
                      </td>
                      <td className="whitespace-nowrap px-3 text-[12.5px] text-muted-foreground">
                        {formatJalaliDate(row.latest.date)} · {fa(row.count)} ثبت
                      </td>
                      {canManage && (
                        <td className="px-3 text-end">
                          <Button variant="ghost" size="sm" onClick={() => startNewRate(row.currency)}>
                            نرخ تازه
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && rows.length > 0 && (
              <p className="border-t px-4 py-2.5 text-[12.5px] text-muted-foreground">
                برای {missing.map((c) => CURRENCY_NAMES[c]).join('، ')} نرخی ثبت نشده است.
              </p>
            )}
          </div>

          <SectionCard title="تاریخچه نرخ‌ها" count={fa(history.length)}>
            {history.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">هر نرخی که ثبت شود، اینجا با تاریخش می‌ماند.</p>
            ) : (
              <div className="-mx-4 -mb-4 max-h-[420px] overflow-y-auto border-t">
                <table className="w-full text-[13.5px]">
                  <thead className="sticky top-0">
                    <tr className="border-b">
                      <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">تاریخ</th>
                      <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">ارز</th>
                      <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">نرخ (تومان)</th>
                      <th className="h-9 bg-secondary px-4 text-end text-xs font-normal text-muted-foreground">نسبت به ثبت قبلی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((rate) => (
                      <tr key={rate.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                        <td className="whitespace-nowrap px-4 tabular-nums text-muted-foreground">{formatJalaliDateTime(rate.date)}</td>
                        <td className="px-3">
                          {CURRENCY_NAMES[rate.currency] ?? rate.currency}{' '}
                          <span className="font-mono text-[11.5px] text-muted-foreground">{rate.currency}</span>
                        </td>
                        <td className="px-3 text-end tabular-nums">{rateText(rate.rateToToman)}</td>
                        <td className="px-4 text-end tabular-nums text-muted-foreground" dir="ltr">
                          {rate.change === null ? '—' : `${rate.change > 0 ? '+' : ''}${fa(rate.change, 1)}٪`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="مبدل">
            {rows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">با ثبت اولین نرخ، مبدل آماده می‌شود.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="calcAmount" className="text-xs text-muted-foreground">
                      مبلغ ({toToman ? calcCurrency : 'تومان'})
                    </Label>
                    <Input
                      id="calcAmount"
                      type="number"
                      min="0"
                      dir="ltr"
                      className="tabular-nums"
                      value={calcAmount}
                      onChange={(e) => setCalcAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">ارز</Label>
                    <Select value={calcCurrency} onValueChange={setCalcCurrency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rows.map((row) => (
                          <SelectItem key={row.currency} value={row.currency}>
                            {row.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <div>
                    <p className="text-[12px] text-muted-foreground">{toToman ? 'به تومان' : `به ${CURRENCY_NAMES[calcCurrency]}`}</p>
                    <p className="text-[19px] font-medium tabular-nums">
                      {fa(converted, toToman ? 0 : 2)}
                      <small className="ms-1 text-[11px] font-normal text-muted-foreground">{toToman ? 'تومان' : calcCurrency}</small>
                    </p>
                  </div>
                  <Button variant="outline" size="icon" onClick={() => setToToman((v) => !v)} title="جابه‌جایی جهت تبدیل">
                    <ArrowLeftRight className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  با آخرین نرخ ثبت‌شده: هر ۱ {calcCurrency} = {rateText(calcRate)} تومان
                </p>
              </div>
            )}
          </SectionCard>

          {canManage && (
            <SectionCard title="ثبت نرخ">
              <form action={dispatch} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="currency">ارز</Label>
                  <Select name="currency" required value={formCurrency} onValueChange={setFormCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="انتخاب ارز" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={Currency.USD}>دلار ({Currency.USD})</SelectItem>
                      <SelectItem value={Currency.EUR}>یورو ({Currency.EUR})</SelectItem>
                      <SelectItem value={Currency.CNY}>یوآن ({Currency.CNY})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rateToToman">نرخ تبدیل به تومان</Label>
                  <Input
                    ref={rateInput}
                    id="rateToToman"
                    name="rateToToman"
                    type="number"
                    placeholder="مثال: 60000"
                    dir="ltr"
                    className="tabular-nums"
                    required
                  />
                  <p className="text-[12px] text-muted-foreground">تومان به ازای هر ۱ واحد ارز. نرخ قبلی در تاریخچه می‌ماند.</p>
                </div>
                {state.message && (
                  <div
                    className={cn(
                      'rounded-md px-3 py-2 text-[13px]',
                      succeeded ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                    )}
                  >
                    {state.message}
                  </div>
                )}
                <SubmitButton />
              </form>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت نرخ'}
    </Button>
  );
}
