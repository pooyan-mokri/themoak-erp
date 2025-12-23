'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, CheckCircle, DollarSign } from 'lucide-react';

interface StockKPICardsProps {
  product: {
    totalStock: number;
    availableStock: number;
    stockValue: number;
  };
}

export function StockKPICards({ product }: StockKPICardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">موجودی کل</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{product.totalStock}</div>
          <p className="text-xs text-muted-foreground">
            تمام انبارها
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">قابل فروش</CardTitle>
          <CheckCircle className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{product.availableStock}</div>
          <p className="text-xs text-muted-foreground">
            انبارهای فیزیکی
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">ارزش موجودی</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(product.stockValue)}</div>
          <p className="text-xs text-muted-foreground">
            بر اساس قیمت تمام شده
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
