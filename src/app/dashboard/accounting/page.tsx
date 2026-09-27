import Link from 'next/link';
import moment from 'moment-jalaali';
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
import { getJalaliMonthName, getStartOfJalaliMonth } from '@/lib/date-utils';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);
/** The day as the journal's address carries it (?from=YYYY-MM-DD), in local time. */
const isoDay = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

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

  const monthStart = getStartOfJalaliMonth();
  const monthName = getJalaliMonthName(moment().jMonth() + 1);
  const [accounts, rates, receivables, monthRows, payrolls] = await Promise.all([
    getAccounts(),
    getLatestExchangeRates(),
    getARAgingReport(),
    getTransactions({ from: isoDay(monthStart) }),
    canSeePayroll ? getPayrolls() : Promise.resolve(null),
  ]);

  // Cash: bank and cash accounts, a foreign balance at its currency's latest rate. A
  // currency with no rate is left out and named, never added to Toman as it is.
  const latestRate = new Map<string, number>();
  for (const rate of rates) if (!latestRate.has(rate.currency)) latestRate.set(rate.currency, Number(rate.rateToToman));
  let cash = 0;
  let converted = false;
  const unrated = new Set<string>();
  for (const account of accounts.filter((a: any) => a.type === 'BANK' || a.type === 'CASH')) {
    if (account.currency === 'TOMAN') cash += account.balance;
    else if (latestRate.has(account.currency)) {
      cash += account.balance * latestRate.get(account.currency)!;
      converted = true;
    } else if (account.balance !== 0) unrated.add(account.currency);
  }
  const cashNote = unrated.size
    ? `بدون حساب‌های ${Array.from(unrated).map(currencyName).join('، ')} (نرخی ثبت نشده)`
    : converted
      ? 'بانک و صندوق · ارزی با آخرین نرخ'
      : 'بانک و صندوق';

  const receivable = receivables.reduce((sum: number, customer: any) => sum + Number(customer.totalDue), 0);

  // This month's expenses: the journal's EXPENSE rows from the first of the Jalali month.
  const expenseRows = monthRows.filter((t: any) => t.type === 'EXPENSE' && new Date(t.date) >= monthStart);
  const monthExpenses = expenseRows.reduce((sum: number, t: any) => sum + (t.amountInToman ?? 0), 0);
  const withheld = expenseRows.filter((t: any) => t.amountInToman === null).length;
  const expenseNote = [
    `${fa(expenseRows.length)} سند`,
    withheld ? 'بدون بهای تمام‌شده' : null,
    monthRows.length >= JOURNAL_MAX_ROWS ? 'بیش از سقف دفتر؛ جمع ناقص است' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // This month's payroll: the payslips of the current Jalali period.
  const thisPeriod = payrolls?.filter((p: any) => p.periodYear === moment().jYear() && p.periodMonth === moment().jMonth() + 1) ?? [];
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
          <KpiCard label="موجودی نقد" icon={Wallet} value={fa(cash)} unit="تومان" note={cashNote} />
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
            label={`هزینه‌های ${monthName}`}
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
