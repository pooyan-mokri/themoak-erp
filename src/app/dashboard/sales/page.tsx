import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Users, History, BarChart3, RotateCcw } from 'lucide-react';
import Link from 'next/link';

export default function SalesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت فروش</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link href="/dashboard/sales/pos">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                صندوق فروش (POS)
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ثبت سفارش جدید</div>
              <p className="text-xs text-muted-foreground">
                فروش مستقیم کالا به مشتری
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales/customers">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                مشتریان
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت مشتریان</div>
              <p className="text-xs text-muted-foreground">
                لیست مشتریان و اطلاعات تماس
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales/history">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                تاریخچه سفارشات
              </CardTitle>
              <History className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">تاریخچه فروش</div>
              <p className="text-xs text-muted-foreground">
                مشاهده لیست سفارشات و جزئیات
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales/analytics">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                گزارشات و تحلیل
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">آمار و نمودارها</div>
              <p className="text-xs text-muted-foreground">
                تحلیل فروش، نمودار و پیش‌بینی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales/returns">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                عودت‌ها و تعویض‌ها
              </CardTitle>
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">تاریخچه برگشتی‌ها</div>
              <p className="text-xs text-muted-foreground">
                لیست همه عودت‌ها و تعویض‌های ثبت‌شده
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                فروش امانی
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت امانی</div>
              <p className="text-xs text-muted-foreground">
                همکاران، انتقال و تسویه حساب
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
