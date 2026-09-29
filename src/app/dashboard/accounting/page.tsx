import Link from 'next/link';
import { ArrowDownLeft, Calculator, Plus, Receipt, Users, Wallet } from 'lucide-react';
import { getAccounts, getLatestExchangeRates, getTransactions } from '@/actions/accounting';
import { getARAgingReport } from '@/actions/invoice';
import { getPayrolls } from '@/actions/payroll';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { Button } from '@/components/ui/button';
import { AccountingHubTiles } from '@/components/accounting/accounting-hub';
import { HUB_TILES } from '@/components/accounting/hub-tiles';
import { currencyName } from '@/components/accounting/amount-words';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';
import { can, canAccessRoute } from '@/lib/permissions';
import { getJalaliMonthName } from '@/lib/date-utils';
import { cashPosition } from '@/lib/money-totals';
import { profitEntry } from '@/lib/profit-rows';
import { jalaliYearMonth, tehranDay } from '@/lib/tehran-day';
import { periodAt } from '@/components/reports/pnl-periods';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
/** The day as the journal's address carries it (?from=YYYY-MM-DD): a Tehran day (src/lib/tehran-day.ts). */
const isoDay = (date: Date) => tehranDay(date);

/** A KPI that opens the page its figure comes from. */
function KpiLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-lg transition-colors duration-150 [&>div]:hover:border-brand">
      {children}
    </Link>
  );
}

export default async function AccountingPage() {
  await requireRouteAccess('/dashboard/accounting');
  const role = await getCurrentRole();
  const canRecord = can(role, 'finance.manage');
  const canSeePayroll = can(role, 'payroll.view');

  // This Jalali month, from its Tehran midnight, whatever zone the server runs in.
  const monthStart = periodAt('month', new Date()).from;
  const { year: thisYear, month: thisMonth } = jalaliYearMonth(new Date());
  const monthName = getJalaliMonthName(thisMonth);
  const [accounts, rates, receivables, monthRows, payrolls] = await Promise.all([
    getAccounts(),
    getLatestExchangeRates(),
    getARAgingReport(),
    getTransactions({ from: isoDay(monthStart) }),
    canSeePayroll ? getPayrolls() : Promise.resolve(null),
  ]);

  // «موجودی کل», as the dashboard and the balance sheet count it (src/lib/money-totals.ts): every account that
  // holds money, a foreign balance at its currency's latest rate. A currency with no rate is named, not added.
  // (getLatestExchangeRates is newest first, so the first row of a currency is its latest rate.)
  const position = cashPosition(
    accounts.filter((a: any) => a.type !== 'EXPENSE'),
    rates.map((rate: any) => ({ currency: rate.currency, rateToToman: rate.rateToToman, date: new Date(rate.date) })),
  );
  const cash = position.total;
  const unrated = position.unpriced.filter((row) => row.total !== 0).map((row) => row.currency);
  const cashNote = unrated.length
    ? `بدون حساب‌های ${unrated.map(currencyName).join('، ')} (نرخی ثبت نشده)`
    : position.foreign.length
      ? 'همه حساب‌ها · ارزها به آخرین نرخ'
      : 'همه حساب‌ها';

  const receivable = receivables.reduce((sum: number, customer: any) => sum + Number(customer.totalDue), 0);

  // This month's operating expenses, as the profit and loss counts them (src/lib/profit-rows.ts): not the cost of
  // goods sold, not a supplier payment (stock) or a fixed asset, not capital, loans, transfers or currency trades.
  const expenseRows = monthRows.filter(
    (t: any) => new Date(t.date) >= monthStart && profitEntry({ ...t, amountInToman: t.amountInToman ?? 0 })?.line === 'expense',
  );
  const monthExpenses = expenseRows.reduce((sum: number, t: any) => sum + (profitEntry(t)?.amount ?? 0), 0);
  const withheld = expenseRows.filter((t: any) => t.amountInToman === null).length;
  const expenseNote = [
    `${fa(expenseRows.length)} سند`,
    withheld ? 'بدون بهای تمام‌شده' : null,
    monthRows.length >= JOURNAL_MAX_ROWS ? 'بیش از سقف دفتر؛ جمع ناقص است' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // This month's payroll: the payslips of the current Jalali period.
  const thisPeriod = payrolls?.filter((p: any) => p.periodYear === thisYear && p.periodMonth === thisMonth) ?? [];
  const payrollTotal = thisPeriod.reduce((sum: number, p: any) => sum + p.netAmount, 0);
  const payrollPaid = thisPeriod.reduce((sum: number, p: any) => sum + p.paidAmount, 0);

  const visible = HUB_TILES.filter((tile) => canAccessRoute(role, tile.href) && (!tile.records || canRecord)).map((tile) => tile.href);

  return (
    <div className="space-y-4">
      <PageHeader
        title="حسابداری و مالی"
        description={`${fa(visible.length)} بخش · همه عملیات مالی شرکت در یک مرکز`}
        actions={
          <>
            {canAccessRoute(role, '/dashboard/accounting/reports') && (
              <Button variant="outline" asChild>
                <Link href="/dashboard/accounting/reports">
                  <Calculator className="h-4 w-4" />
                  صورت سود و زیان
                </Link>
              </Button>
            )}
            {canRecord && (
              <Button asChild>
                <Link href="/dashboard/accounting/expenses/new">
                  <Plus className="h-4 w-4" />
                  ثبت هزینه
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiLink href="/dashboard/accounting/accounts">
          <KpiCard label="موجودی کل" icon={Wallet} value={fa(Math.round(cash))} unit="تومان" note={cashNote} />
        </KpiLink>
        <KpiLink href="/dashboard/accounting/ar-aging">
          <KpiCard
            label="مطالبات"
            icon={ArrowDownLeft}
            value={receivable ? fa(receivable) : '—'}
            unit={receivable ? 'تومان' : undefined}
            note={receivable ? `${fa(receivables.length)} مشتری بدهکار` : 'طلبی از مشتریان نیست'}
          />
        </KpiLink>
        <KpiLink href={`/dashboard/accounting/transactions?from=${isoDay(monthStart)}`}>
          <KpiCard
            label={`هزینه‌های عملیاتی ${monthName}`}
            icon={Receipt}
            value={monthExpenses ? fa(monthExpenses) : '—'}
            unit={monthExpenses ? 'تومان' : undefined}
            note={expenseNote}
          />
        </KpiLink>
        {payrolls && (
          <KpiLink href="/dashboard/accounting/payroll">
            <KpiCard
              label={`حقوق ${monthName}`}
              icon={Users}
              value={thisPeriod.length ? fa(payrollTotal) : '—'}
              unit={thisPeriod.length ? 'تومان' : undefined}
              note={
                thisPeriod.length
                  ? `${fa(thisPeriod.length)} فیش · ${payrollPaid >= payrollTotal ? 'همه پرداخت شده' : `${fa(payrollTotal - payrollPaid)} مانده`}`
                  : `فیش ${monthName} هنوز ثبت نشده`
              }
            />
          </KpiLink>
        )}
      </div>

      <AccountingHubTiles visible={visible} />
    </div>
  );
}
