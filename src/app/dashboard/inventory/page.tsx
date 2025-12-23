import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Warehouse, Building2, BarChart3, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت موجودی و انبار</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/dashboard/inventory/audits">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
                انبارگردانی
              </CardTitle>
              <ClipboardCheck className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900 dark:text-green-100">سیستم انبارگردانی</div>
              <p className="text-xs text-green-600 dark:text-green-400">
                مدیریت عملیات انبارگردانی، شمارش موجودی و صدور اسناد اصلاحی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory/products">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                تعریف کالا
              </CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت کالاها</div>
              <p className="text-xs text-muted-foreground">
                تعریف و مدیریت انواع کالاها (محصول فروختنی، دارایی ثابت، کالای مصرفی)
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory/warehouses">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                انبارها
              </CardTitle>
              <Warehouse className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت انبارها</div>
              <p className="text-xs text-muted-foreground">
                تعریف انبارهای فیزیکی و مجازی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory/assets">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                دارایی‌های ثابت و مصرفی
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت دارایی‌ها</div>
              <p className="text-xs text-muted-foreground">
                ثبت و مدیریت دارایی‌های ثابت و کالاهای مصرفی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory/console">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
                کنسول انبار
              </CardTitle>
              <Warehouse className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">عملیات انبار و موجودی</div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                مشاهده موجودی لحظه‌ای، انتقال بین انبارها و گزارشات
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory/reports">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">
                گزارش موجودی
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">گزارشات جامع</div>
              <p className="text-xs text-purple-600 dark:text-purple-400">
                گزارش موجودی کل، کمبودها و توزیع موجودی بین انبارها
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
