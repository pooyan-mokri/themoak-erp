'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, DollarSign, TrendingUp, Zap } from 'lucide-react';

interface SalesAnalyticsCardsProps {
  analytics: {
    totalUnitsSold: number;
    totalRevenue: number;
    avgSellingPrice: number;
    velocityPerWeek: number;
    velocityPerMonth: number;
    velocityPerYear: number;
  };
}

export function SalesAnalyticsCards({ analytics }: SalesAnalyticsCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' تومان';
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">کل فروش</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analytics.totalUnitsSold}</div>
          <p className="text-xs text-muted-foreground">
            واحد فروخته شده
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">درآمد کل</CardTitle>
          <DollarSign className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(analytics.totalRevenue)}</div>
          <p className="text-xs text-muted-foreground">
            از ابتدا تا کنون
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">سرعت فروش</CardTitle>
          <Zap className="h-4 w-4 text-orange-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analytics.velocityPerMonth.toFixed(1)}</div>
          <p className="text-xs text-muted-foreground">
            واحد در ماه
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">میانگین قیمت</CardTitle>
          <TrendingUp className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(analytics.avgSellingPrice)}</div>
          <p className="text-xs text-muted-foreground">
            قیمت واقعی فروش
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
