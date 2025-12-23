import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, TrendingUp, Package } from 'lucide-react';
import Link from 'next/link';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارشات</h1>
        <p className="text-muted-foreground">
          تحلیل جامع عملکرد کسب‌وکار
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/dashboard/reports/financial">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-100 p-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <CardTitle>گزارشات مالی</CardTitle>
              </div>
              <CardDescription>
                سود و زیان، ترازنامه، و جریان نقدینگی
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                مشاهده گزارشات
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/reports/sales">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-2">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                </div>
                <CardTitle>گزارشات فروش</CardTitle>
              </div>
              <CardDescription>
                تحلیل فروش بر اساس محصول، مشتری و زمان
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                مشاهده گزارشات
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/reports/inventory">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-100 p-2">
                  <Package className="h-5 w-5 text-orange-600" />
                </div>
                <CardTitle>گزارشات موجودی</CardTitle>
              </div>
              <CardDescription>
                گردش موجودی و تحلیل قدمت کالا
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                مشاهده گزارشات
              </Button>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
