import { getMarketingStats } from '@/actions/marketing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Gift, TrendingUp, DollarSign, Package, Megaphone } from 'lucide-react';
import Link from 'next/link';

export default async function MarketingPage() {
  const stats = await getMarketingStats();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">بازاریابی</h1>
        <p className="text-muted-foreground mt-2">
          مدیریت هدایای بازاریابی و کمپین‌ها
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل هدایا</CardTitle>
            <Gift className="h-4 w-4 text-pink-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats.totalGifts)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatNumber(stats.totalQuantity)} عدد محصول
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل هزینه</CardTitle>
            <DollarSign className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalCost)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              هزینه بازاریابی
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کمپین‌های فعال</CardTitle>
            <Megaphone className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats.activeCampaigns)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              از {formatNumber(stats.totalCampaigns)} کمپین
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">بودجه باقیمانده</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.remainingBudget)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              از {formatCurrency(stats.totalBudget)} بودجه کل
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/dashboard/marketing/gifts/new">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-pink-200 dark:border-pink-900 bg-pink-50/50 dark:bg-pink-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-pink-700 dark:text-pink-300">
                ثبت هدیه
              </CardTitle>
              <Gift className="h-4 w-4 text-pink-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-pink-900 dark:text-pink-100">هدیه جدید</div>
              <p className="text-xs text-pink-600 dark:text-pink-400">
                ثبت هدیه بازاریابی به مشتری یا شخص
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/marketing/gifts">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                تاریخچه هدایا
              </CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مشاهده هدایا</div>
              <p className="text-xs text-muted-foreground">
                لیست تمام هدایای ثبت شده
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/marketing/campaigns">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                کمپین‌ها
              </CardTitle>
              <Megaphone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت کمپین</div>
              <p className="text-xs text-muted-foreground">
                ایجاد و مدیریت کمپین‌های بازاریابی
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}



