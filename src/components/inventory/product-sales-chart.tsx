'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface ProductSalesChartProps {
  salesHistory: Array<{
    month: string;
    units: number;
    revenue: number;
  }>;
}

export function ProductSalesChart({ salesHistory }: ProductSalesChartProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(amount);
  };

  // Convert YYYY-MM to Persian month name
  const getMonthLabel = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const monthNames = [
      'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
      'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
    ];
    const monthIndex = parseInt(month, 10) - 1;
    return monthNames[monthIndex] || month;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          روند فروش (12 ماه اخیر)
        </CardTitle>
        <CardDescription>
          نمودار تعداد و درآمد فروش ماهانه
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={salesHistory}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="month" 
              tickFormatter={getMonthLabel}
              style={{ fontSize: '12px' }}
            />
            <YAxis 
              yAxisId="left"
              orientation="left"
              stroke="#8884d8"
              tickFormatter={(value) => value.toString()}
              style={{ fontSize: '12px' }}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="#82ca9d"
              tickFormatter={(value) => formatCurrency(value)}
              style={{ fontSize: '12px' }}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === 'units') return [value + ' عدد', 'تعداد'];
                if (name === 'revenue') return [formatCurrency(value) + ' تومان', 'درآمد'];
                return [value, name];
              }}
              labelFormatter={(label) => getMonthLabel(label)}
            />
            <Legend 
              formatter={(value) => {
                if (value === 'units') return 'تعداد فروش';
                if (value === 'revenue') return 'درآمد';
                return value;
              }}
            />
            <Bar yAxisId="left" dataKey="units" fill="#8884d8" name="units" />
            <Bar yAxisId="right" dataKey="revenue" fill="#82ca9d" name="revenue" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
