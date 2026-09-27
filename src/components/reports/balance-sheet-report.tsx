'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { formatJalaliDate } from '@/lib/date-utils';
import type { CurrencyTotal } from '@/lib/money-totals';

interface BalanceSheetData {
  assets: {
    /** Toman accounts only. */
    cash: number;
    /** Each other currency's accounts, in that currency, with the latest rate when one is recorded. */
    foreignCash?: CurrencyTotal[];
    /** total with the foreign cash at the latest rates; null while a currency has no rate. */
    approxTotalWithForeign?: number | null;
    inventory: number;
    consignmentInventory?: number;
    accountsReceivable: number;
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

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

export function BalanceSheetReport({ data }: BalanceSheetReportProps) {
  const { assets, liabilities, equity } = data;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(value)) + ' تومان';
  };
  const formatNumber = (value: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value);
  const foreignCash = assets.foreignCash ?? [];

  const assetBreakdown = [
    { name: 'نقدینگی', value: assets.cash },
    { name: 'موجودی کالا (خودی)', value: assets.inventory },
    { name: 'کالای امانی نزد همکاران', value: assets.consignmentInventory ?? 0 },
    { name: 'حساب‌های دریافتنی', value: assets.accountsReceivable },
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
              {/* A foreign balance is not added to the Toman figures: it is shown in its own currency. */}
              {foreignCash.map((foreign) => (
                <div key={foreign.currency} className="flex justify-between">
                  <span className="text-muted-foreground">{`نقدینگی ${foreign.currency}:`}</span>
                  <span>
                    {`${formatNumber(foreign.total)} ${foreign.currency}`}
                    {foreign.rate !== null && foreign.approxToman !== null
                      ? ` ≈ ${formatCurrency(foreign.approxToman)} (نرخ ${formatNumber(foreign.rate)} در ${formatJalaliDate(foreign.rateDate ?? undefined)})`
                      : ' (نرخی ثبت نشده است)'}
                  </span>
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
              {foreignCash.length > 0 && (
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">جمع با احتساب ارز (تقریبی):</span>
                  <span>
                    {assets.approxTotalWithForeign != null
                      ? formatCurrency(assets.approxTotalWithForeign)
                      : 'نرخ برخی ارزها ثبت نشده است'}
                  </span>
                </div>
              )}
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
