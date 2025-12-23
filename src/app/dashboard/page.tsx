import {
  getDashboardFinancials,
  getDashboardSales,
  getLowStockItems,
  getRecentActivity,
  getUserTasks,
} from '@/actions/dashboard';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { SalesChart } from '@/components/dashboard/sales-chart';
import { LowStockAlert } from '@/components/dashboard/low-stock-alert';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { MyTasksWidget } from '@/components/dashboard/my-tasks-widget';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Package, DollarSign, Gift, Bot } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardPage() {
  // Fetch all dashboard data in parallel
  const [financials, sales, lowStockItems, recentActivity, userTasks] = await Promise.all([
    getDashboardFinancials(),
    getDashboardSales(),
    getLowStockItems(),
    getRecentActivity(),
    getUserTasks(),
  ]);

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div className="animate-fade-in-down">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">داشبورد</h2>
        <p className="text-muted-foreground text-sm md:text-base">
          نمای کلی کسب‌وکار شما
        </p>
      </div>

      {/* Mobile Quick Actions - Visible only on mobile */}
      <div className="md:hidden space-y-3 pb-4 border-b">
        <h3 className="text-lg font-semibold">دسترسی سریع</h3>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/dashboard/sales/pos">
            <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center space-y-2">
                <ShoppingCart className="h-8 w-8 text-orange-700" />
                <CardTitle className="text-base">ثبت فروش</CardTitle>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/accounting/expenses/new">
            <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center space-y-2">
                <DollarSign className="h-8 w-8 text-red-600" />
                <CardTitle className="text-base">ثبت هزینه</CardTitle>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/marketing/gifts/new">
            <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center space-y-2">
                <Gift className="h-8 w-8 text-pink-600" />
                <CardTitle className="text-base">ثبت هدیه</CardTitle>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/assistant">
            <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center space-y-2">
                <Bot className="h-8 w-8 text-cyan-500" />
                <CardTitle className="text-base">دستیار</CardTitle>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Financial Overview */}
      <FinancialCards financials={financials} />

      {/* Sales Analytics & Alerts - 2 Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Sales Chart */}
        <div>
          <SalesChart sales={sales} />
        </div>

        {/* Right Column: Alerts & Activity */}
        <div className="space-y-6">
          <LowStockAlert items={lowStockItems} />
          <MyTasksWidget tasks={userTasks} />
        </div>
      </div>

      {/* Recent Activity - Full Width */}
      <RecentActivity activities={recentActivity} />

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/dashboard/suppliers/orders">
          <Card className="hover:bg-muted/50 hover:scale-[1.02] transition-all duration-300 cursor-pointer animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                بخش خرید
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground hover:animate-wiggle" />
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">سفارشات خرید</div>
              <p className="text-xs text-muted-foreground mt-1">
                ثبت و مدیریت سفارشات خرید
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/inventory">
          <Card className="hover:bg-muted/50 hover:scale-[1.02] transition-all duration-300 cursor-pointer animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                انبارداری
              </CardTitle>
              <Package className="h-4 w-4 text-muted-foreground hover:animate-wiggle" />
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">مدیریت موجودی</div>
              <p className="text-xs text-muted-foreground mt-1">
                مدیریت کالاها و موجودی انبار
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
