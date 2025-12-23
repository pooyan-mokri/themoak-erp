import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, ShoppingCart, PackagePlus } from 'lucide-react';
import Link from 'next/link';

export default function SuppliersDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت زنجیره تامین</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/dashboard/suppliers/management">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                تامین‌کنندگان
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">لیست تامین‌کنندگان</div>
              <p className="text-xs text-muted-foreground">
                مدیریت اطلاعات تماس و قراردادها
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/suppliers/orders">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                سفارشات خرید
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت سفارشات</div>
              <p className="text-xs text-muted-foreground">
                ثبت و پیگیری سفارشات خرید
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/suppliers/orders/new">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                خرید جدید
              </CardTitle>
              <PackagePlus className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ثبت سفارش</div>
              <p className="text-xs text-muted-foreground">
                ایجاد سریع سفارش خرید جدید
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
