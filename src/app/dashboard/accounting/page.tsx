import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator, CreditCard, DollarSign, Receipt, Users, HandCoins, UserCircle, Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

export default function AccountingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">حسابداری و مالی</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/dashboard/accounting/accounts">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                حساب‌ها
              </CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت حساب‌ها</div>
              <p className="text-xs text-muted-foreground">
                تعریف بانک، صندوق و حساب اشخاص
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/expenses/new">
          <Card className="hover:bg-red-100/50 dark:hover:bg-red-950/20 transition-colors cursor-pointer h-full border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/10 shadow-md hover:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300">
                ثبت هزینه
              </CardTitle>
              <Receipt className="h-5 w-5 text-red-600 dark:text-red-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-900 dark:text-red-100">هزینه جدید</div>
              <p className="text-xs text-red-700 dark:text-red-300">
                ثبت هزینه‌های جاری و پروژه‌ای
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/exchange-rates">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                نرخ ارز
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت نرخ ارز</div>
              <p className="text-xs text-muted-foreground">
                بروزرسانی نرخ تبدیل ارزها
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/reports">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                گزارش‌های مالی
              </CardTitle>
              <Calculator className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">گزارش‌ها</div>
              <p className="text-xs text-muted-foreground">
                صورت سود و زیان و ترازنامه
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/transactions">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                دفتر روزنامه
              </CardTitle>
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">تراکنش‌ها</div>
              <p className="text-xs text-muted-foreground">
                مشاهده تمام تراکنش‌های مالی
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/currency-exchange">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
                خرید و فروش ارز
              </CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">معامله ارز</div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                خرید و فروش ارز بین حساب‌های مختلف
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/shareholders">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                صاحبان سهام
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت سهامداران</div>
              <p className="text-xs text-muted-foreground">
                تعریف صاحبان سهام و واریز سرمایه
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/loans">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                قرض‌ها
              </CardTitle>
              <HandCoins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت قرض‌ها</div>
              <p className="text-xs text-muted-foreground">
                ثبت و مدیریت قرض‌های کارمندان
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/employees">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                کارمندان
              </CardTitle>
              <UserCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت کارمندان</div>
              <p className="text-xs text-muted-foreground">
                تعریف و مدیریت اطلاعات کارمندان
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/payroll">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                حقوق و دستمزد
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">مدیریت حقوق</div>
              <p className="text-xs text-muted-foreground">
                ثبت فیش حقوقی و پرداخت حقوق
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/employee-debts">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                بدهی کارمندان
              </CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Accounts Payable</div>
              <p className="text-xs text-muted-foreground">
                مشاهده و بازپرداخت بدهی کارمندان
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/accounting/ar-aging">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
                طلب از مشتریان
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900 dark:text-green-100">حساب‌های دریافتنی</div>
              <p className="text-xs text-green-600 dark:text-green-400">
                گزارش سنی مطالبات و مشتریان بدهکار
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
