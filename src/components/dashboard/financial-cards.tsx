'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
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

export function FinancialCards({ financials }: FinancialCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
  };
  const formatNumber = (amount: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(amount);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Total Balance */}
      <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.1s' }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">موجودی کل</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground animate-pulse-slow" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(Math.round(financials.totalBalance))}</div>
          <p className="text-xs text-muted-foreground">
            همه حساب‌ها، ارزها به آخرین نرخ ثبت‌شده
          </p>
          {(financials.balancesByType ?? []).map((part) => (
            <p key={part.type} className="text-xs text-muted-foreground mt-1">
              {`${ACCOUNT_TYPE_LABELS[part.type] ?? part.type}: ${formatCurrency(Math.round(part.total))}`}
            </p>
          ))}
          {(financials.foreignBalances ?? []).map((foreign) => (
            <p key={foreign.currency} className="text-xs text-muted-foreground mt-1">
              {`شامل ${formatNumber(foreign.total)} ${foreign.currency} ≈ ${formatCurrency(Math.round(foreign.approxToman))} (نرخ ${formatNumber(foreign.rate)} در ${formatJalaliDate(foreign.rateDate)})`}
            </p>
          ))}
          {/* A currency with no rate cannot be converted: shown on its own, not added. */}
          {(financials.unpricedBalances ?? []).map((unpriced) => (
            <p key={unpriced.currency} className="text-xs text-amber-700 mt-1">
              {`${formatNumber(unpriced.total)} ${unpriced.currency}: نرخی ثبت نشده است (در جمع نیست)`}
            </p>
          ))}
        </CardContent>
      </Card>

      {/* Total Receivables */}
      <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.2s' }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">مطالبات</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600 animate-bounce-in" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(financials.totalReceivables)}</div>
          <p className="text-xs text-muted-foreground">
            طلب از مشتریان
          </p>
        </CardContent>
      </Card>

      {/* Total Payables */}
      <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.3s' }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">بدهی‌ها</CardTitle>
          <TrendingDown className="h-4 w-4 text-red-600 animate-bounce-in" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(financials.totalPayables)}</div>
          <p className="text-xs text-muted-foreground">
            بدهی به تأمین‌کنندگان
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
