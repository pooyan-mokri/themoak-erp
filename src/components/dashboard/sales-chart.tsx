'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatJalaliDate } from '@/lib/date-utils';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface SalesChartProps {
  sales: {
    today: {
      total: number;
      count: number;
    };
    yesterday: {
      total: number;
    };
    dailySales: Array<{
      date: string;
      total: number;
      count: number;
    }>;
    topProducts: Array<{
      id: string;
      name: string;
      units: number;
    }>;
  };
}

export function SalesChart({ sales }: SalesChartProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(amount);
  };

  const percentageChange = sales.yesterday.total > 0
    ? ((sales.today.total - sales.yesterday.total) / sales.yesterday.total) * 100
    : 0;

  const getTrendIcon = () => {
    if (percentageChange > 0) return <ArrowUp className="h-4 w-4 text-green-600" />;
    if (percentageChange < 0) return <ArrowDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-600" />;
  };

  return (
    <div className="space-y-4">
      {/* Today's Sales Card */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">فروش امروز</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(sales.today.total)} تومان</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="animate-bounce-in">{getTrendIcon()}</span>
              <p className="text-xs text-muted-foreground">
                {percentageChange > 0 && '+'}
                {percentageChange.toFixed(1)}% نسبت به دیروز
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {sales.today.count} سفارش
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up hover:scale-[1.02] transition-transform duration-300" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">فروش دیروز</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(sales.yesterday.total)} تومان</div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Chart */}
      <Card>
        <CardHeader>
          <CardTitle>روند فروش (30 روز اخیر)</CardTitle>
          <CardDescription>نمودار فروش روزانه</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={sales.dailySales}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return formatJalaliDate(date, 'jMM/jDD');
                }}
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                tickFormatter={(value) => formatCurrency(value)}
                style={{ fontSize: '12px' }}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value) + ' تومان', 'فروش']}
                labelFormatter={(label) => formatJalaliDate(new Date(label))}
              />
              <Line 
                type="monotone" 
                dataKey="total" 
                stroke="#8884d8" 
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Products */}
      {sales.topProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>پرفروش‌ترین محصولات</CardTitle>
            <CardDescription>5 محصول برتر در 30 روز اخیر</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sales.topProducts.map((product, index) => (
                <div key={product.id} className="flex items-center">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm ml-3">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.units} عدد</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
