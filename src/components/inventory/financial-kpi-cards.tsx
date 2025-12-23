'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, Percent } from 'lucide-react';
import { auth } from '@/auth';

interface FinancialKPICardsProps {
  product: {
    costPrice: number;
    sellPrice: number;
  };
}

export function FinancialKPICards({ product }: FinancialKPICardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
  };

  const margin = product.sellPrice > 0 
    ? ((product.sellPrice - product.costPrice) / product.sellPrice) * 100 
    : 0;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">قیمت خرید</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(product.costPrice)}</div>
          <p className="text-xs text-muted-foreground">
            قیمت تمام شده
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">قیمت فروش</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(product.sellPrice)}</div>
          <p className="text-xs text-muted-foreground">
            قیمت پیشنهادی
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">حاشیه سود</CardTitle>
          <Percent className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{margin.toFixed(1)}%</div>
          <p className="text-xs text-muted-foreground">
            درصد سود
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
