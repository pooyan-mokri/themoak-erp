'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

interface FinancialCardsProps {
  financials: {
    totalBalance: number;
    totalReceivables: number;
    totalPayables: number;
  };
}

export function FinancialCards({ financials }: FinancialCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Total Balance */}
      <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.1s' }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">موجودی کل</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground animate-pulse-slow" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(financials.totalBalance)}</div>
          <p className="text-xs text-muted-foreground">
            بانک‌ها و صندوق
          </p>
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
