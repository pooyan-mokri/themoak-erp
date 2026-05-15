import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Truck, FileCheck, DollarSign, BarChart3, Undo2, FileText } from 'lucide-react';
import Link from 'next/link';

export default function ConsignmentPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت امانی</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/dashboard/consignment/partners">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                همکاران
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">تعریف همکار</div>
              <p className="text-xs text-muted-foreground">
                ایجاد انبار مجازی برای همکاران
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/transfer">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                انتقال کالا
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ارسال بار</div>
              <p className="text-xs text-muted-foreground">
                انتقال موجودی به انبار همکار
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/settlement">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                تسویه حساب
              </CardTitle>
              <FileCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ثبت فروش</div>
              <p className="text-xs text-muted-foreground">
                گزارش فروش همکار و صدور فاکتور
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/commissions">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
                گزارش کمیسیون
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900 dark:text-green-100">طلب از همکاران</div>
              <p className="text-xs text-green-600 dark:text-green-400">
                گزارش کمیسیون‌های پرداخت نشده و طلب از همکاران
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/return">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                برگشت کالا
              </CardTitle>
              <Undo2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">کالای فروش‌نرفته</div>
              <p className="text-xs text-muted-foreground">
                برگشت کالای نفروخته از همکار به انبار اصلی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/statement">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
                کارت حساب همکار
              </CardTitle>
              <FileText className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">صورت‌حساب کامل</div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                ارسالی، فروش، سهم ما، دریافتی و مانده هر همکار
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/consignment/reports">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">
                گزارش جامع
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">گزارشات امانی</div>
              <p className="text-xs text-purple-600 dark:text-purple-400">
                گزارش کامل همکاران، فروش‌ها، موجودی و طلب‌ها
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
