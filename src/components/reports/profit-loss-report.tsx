'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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
}

export function ProfitLossReport({ data }: ProfitLossReportProps) {
  const { summary, monthlyTrend } = data;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(value)) + ' تومان';
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>درآمد کل</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {formatCurrency(summary.income)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>هزینه کل</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {formatCurrency(summary.expenses)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>سود خالص</CardDescription>
            <CardTitle className={`text-2xl ${summary.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(summary.netProfit)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>حاشیه سود</CardDescription>
            <CardTitle className="text-2xl">
              {summary.profitMargin.toFixed(1)}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Monthly Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>روند ماهانه</CardTitle>
          <CardDescription>درآمد و هزینه به تفکیک ماه</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip 
                formatter={(value) => formatCurrency(Number(value))}
                labelStyle={{ direction: 'rtl' }}
              />
              <Legend />
              <Bar dataKey="income" fill="#10b981" name="درآمد" />
              <Bar dataKey="expenses" fill="#ef4444" name="هزینه" />
              <Bar dataKey="profit" fill="#3b82f6" name="سود" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
