import { ArrowDownLeft, Landmark, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { formatJalaliDate } from '@/lib/date-utils';
import type { CashPosition } from '@/lib/money-totals';
import { ACCOUNT_TYPE_LABELS } from '@/lib/account-label';

interface FinancialCardsProps {
  financials: {
    /** Every account that holds money, foreign ones converted at the latest rate. */
    totalBalance: number;
    balancesByType?: CashPosition['byType'];
    /** The foreign currencies converted, with the rate used. */
    foreignBalances?: CashPosition['foreign'];
    /** Foreign currencies with no rate recorded: not in the total. */
    unpricedBalances?: CashPosition['unpriced'];
    totalReceivables: number;
    totalPayables: number;
  };
}

const toman = (amount: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(amount);
const number = (amount: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(amount);

/**
 * The dashboard's money figures (src/lib/money-totals.ts), three KPI cards for
 * the dashboard's KPI grid: «موجودی کل» with what it is made of and the rate
 * each foreign currency was converted at, «مطالبات», and what is still to pay
 * on the purchase orders placed with suppliers.
 */
export function FinancialCards({ financials }: FinancialCardsProps) {
  const byType = financials.balancesByType ?? [];
  const foreign = financials.foreignBalances ?? [];
  const unpriced = financials.unpricedBalances ?? [];
  return (
    <>
      <KpiCard
        label="موجودی کل"
        icon={Wallet}
        value={toman(Math.round(financials.totalBalance))}
        unit="تومان"
        note={
          <div className="w-full space-y-0.5">
            <p>همه حساب‌ها، ارزها به آخرین نرخ ثبت‌شده</p>
            {byType.map((part) => (
              <p key={part.type} className="tabular-nums">
                {`${ACCOUNT_TYPE_LABELS[part.type] ?? part.type}: ${toman(Math.round(part.total))} تومان`}
              </p>
            ))}
            {foreign.map((row) => (
              <p key={row.currency} className="tabular-nums">
                {`شامل ${number(row.total)} ${row.currency} ≈ ${toman(Math.round(row.approxToman))} تومان (نرخ ${number(row.rate)} در ${formatJalaliDate(row.rateDate)})`}
              </p>
            ))}
            {/* A currency with no rate cannot be converted: shown on its own, not added. */}
            {unpriced.map((row) => (
              <p key={row.currency} className="tabular-nums text-warning">
                {`${number(row.total)} ${row.currency}: نرخی ثبت نشده است (در جمع نیست)`}
              </p>
            ))}
          </div>
        }
      />
      <KpiCard
        label="مطالبات"
        icon={ArrowDownLeft}
        value={toman(financials.totalReceivables)}
        unit="تومان"
        note="طلب از مشتریان"
      />
      <KpiCard
        label="مانده پرداخت به تأمین‌کنندگان"
        icon={Landmark}
        value={financials.totalPayables ? toman(financials.totalPayables) : '—'}
        unit={financials.totalPayables ? 'تومان' : undefined}
        note="پرداخت‌نشده از سفارش‌های خرید ثبت‌شده"
      />
    </>
  );
}
