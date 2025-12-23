import { getBalanceSheet, getProfitAndLoss, getSalesPerformance } from '@/actions/reporting';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowDownIcon, ArrowUpIcon, TrendingUp } from 'lucide-react';

export default async function ReportsPage() {
  const pl = await getProfitAndLoss();
  const bs = await getBalanceSheet();
  const sales = await getSalesPerformance();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">گزارش‌های مالی</h1>

      {/* Profit & Loss Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          صورت سود و زیان (کلی)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">درآمد کل</CardTitle>
              <ArrowUpIcon className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {pl.totalIncome.toLocaleString()} تومان
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">هزینه کل</CardTitle>
              <ArrowDownIcon className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {pl.totalExpense.toLocaleString()} تومان
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">سود خالص</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${pl.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {pl.netProfit.toLocaleString()} تومان
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Balance Sheet Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">ترازنامه</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>دارایی‌ها</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">نقد و بانک:</span>
                <span className="font-medium">{bs.assets.cashAndBank.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ارزش موجودی کالا:</span>
                <span className="font-medium">{bs.assets.inventory.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">حساب‌های دریافتنی:</span>
                <span className="font-medium">{bs.assets.accountsReceivable.toLocaleString()}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-bold text-lg">
                <span>جمع دارایی‌ها:</span>
                <span>{bs.assets.total.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>بدهی‌ها و حقوق صاحبان سهام</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">جمع بدهی‌ها:</span>
                <span className="font-medium">{bs.liabilities.total.toLocaleString()}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">حقوق صاحبان سهام:</span>
                <span className="font-medium">{bs.equity.total.toLocaleString()}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                (دارایی - بدهی)
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Top Products Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">محصولات پرفروش</h2>
        <Card>
          <CardContent className="p-0">
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">نام محصول</th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">تعداد فروخته شده</th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">مبلغ کل فروش</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {sales.topProducts.map((product, index) => (
                    <tr key={index} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <td className="p-4 align-middle font-medium">{product.name}</td>
                      <td className="p-4 align-middle">{product.quantity}</td>
                      <td className="p-4 align-middle">{product.total.toLocaleString()} تومان</td>
                    </tr>
                  ))}
                  {sales.topProducts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-muted-foreground">
                        هنوز فروشی ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
