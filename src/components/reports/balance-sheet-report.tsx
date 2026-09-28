'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { formatJalaliDate } from '@/lib/date-utils';
import type { CashPosition } from '@/lib/money-totals';
import { ACCOUNT_TYPE_LABELS } from '@/lib/account-label';

interface BalanceSheetData {
  assets: {
    /** Every account that holds money, foreign ones converted at the latest rate. */
    cash: number;
    cashByType?: CashPosition['byType'];
    /** The foreign currencies converted, with the rate used. */
    foreignCash?: CashPosition['foreign'];
    /** Foreign currencies with no rate recorded: not in the cash. */
    unpricedCash?: CashPosition['unpriced'];
    inventory: number;
    consignmentInventory?: number;
    accountsReceivable: number;
    /** Paid on purchase orders whose goods are not in stock yet. */
    prepaidPurchases?: number;
    total: number;
  };
  liabilities: {
    accountsPayable: number;
    total: number;
  };
  equity: {
    total: number;
  };
}

interface BalanceSheetReportProps {
  data: BalanceSheetData;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export function BalanceSheetReport({ data }: BalanceSheetReportProps) {
  const { assets, liabilities, equity } = data;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(value)) + ' تومان';
  };
  const formatNumber = (value: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value);

  const assetBreakdown = [
    { name: 'نقدینگی', value: assets.cash },
    { name: 'موجودی کالا (خودی)', value: assets.inventory },
    { name: 'کالای امانی نزد همکاران', value: assets.consignmentInventory ?? 0 },
    { name: 'حساب‌های دریافتنی', value: assets.accountsReceivable },
    { name: 'پیش‌پرداخت خرید', value: assets.prepaidPurchases ?? 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>دارایی‌ها</CardTitle>
            <CardDescription className="text-2xl font-bold text-green-600">
              {formatCurrency(assets.total)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">نقدینگی:</span>
                <span>{formatCurrency(assets.cash)}</span>
              </div>
              {(assets.cashByType ?? []).map((part) => (
                <div key={part.type} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{`— ${ACCOUNT_TYPE_LABELS[part.type] ?? part.type}:`}</span>
                  <span>{formatCurrency(part.total)}</span>
                </div>
              ))}
              {(assets.foreignCash ?? []).map((foreign) => (
                <div key={foreign.currency} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{`— شامل ${foreign.currency}:`}</span>
                  <span>
                    {`${formatNumber(foreign.total)} ${foreign.currency} ≈ ${formatCurrency(foreign.approxToman)} (نرخ ${formatNumber(foreign.rate)} در ${formatJalaliDate(foreign.rateDate)})`}
                  </span>
                </div>
              ))}
              {/* A currency with no rate cannot be converted: shown on its own, not added. */}
              {(assets.unpricedCash ?? []).map((unpriced) => (
                <div key={unpriced.currency} className="flex justify-between text-xs text-amber-700">
                  <span>{`${unpriced.currency}:`}</span>
                  <span>{`${formatNumber(unpriced.total)} ${unpriced.currency} — نرخی ثبت نشده است (در جمع نیست)`}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-muted-foreground">موجودی کالا (خودی):</span>
                <span>{formatCurrency(assets.inventory)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">کالای امانی نزد همکاران:</span>
                <span>{formatCurrency(assets.consignmentInventory ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">حساب‌های دریافتنی:</span>
                <span>{formatCurrency(assets.accountsReceivable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">پیش‌پرداخت خرید (کالای دریافت‌نشده):</span>
                <span>{formatCurrency(assets.prepaidPurchases ?? 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>بدهی‌ها</CardTitle>
            <CardDescription className="text-2xl font-bold text-red-600">
              {formatCurrency(liabilities.total)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">حساب‌های پرداختنی:</span>
                <span>{formatCurrency(liabilities.accountsPayable)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>سرمایه</CardTitle>
            <CardDescription className="text-2xl font-bold text-blue-600">
              {formatCurrency(equity.total)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              دارایی‌ها - بدهی‌ها = سرمایه
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Asset Breakdown Chart */}
      <Card>
        <CardHeader>
          <CardTitle>تفکیک دارایی‌ها</CardTitle>
          <CardDescription>نمودار ترکیب دارایی‌ها</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={assetBreakdown}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {assetBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
