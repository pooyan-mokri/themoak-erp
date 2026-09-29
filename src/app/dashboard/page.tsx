import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bot,
  Gift,
  PackagePlus,
  Plus,
  Receipt,
  ShoppingCart,
  Zap,
} from 'lucide-react';
import {
  getDashboardFinancials,
  getDashboardSales,
  getLowStockItems,
  getRecentActivity,
  getUserTasks,
} from '@/actions/dashboard';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { QuickActions, type QuickAction } from '@/components/dashboard/quick-actions';
import { SalesChart } from '@/components/dashboard/sales-chart';
import { TopProducts } from '@/components/dashboard/top-products';
import { LowStockAlert } from '@/components/dashboard/low-stock-alert';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { MyTasksWidget } from '@/components/dashboard/my-tasks-widget';
import { Button } from '@/components/ui/button';
import { hasPermission } from '@/lib/access';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

export default async function DashboardPage() {
  // Every signed-in user opens the dashboard: load only what the role may see.
  const [canSeeFinance, canSeeStock, canSell, canManageFinance, canManageStock, canSeeSales] = await Promise.all([
    hasPermission('finance.view'),
    hasPermission('stock.view'),
    hasPermission('sales.manage'),
    hasPermission('finance.manage'),
    hasPermission('stock.manage'),
    hasPermission('sales.view'),
  ]);

  const [financials, sales, lowStockItems, recentActivity, userTasks] = await Promise.all([
    canSeeFinance ? getDashboardFinancials() : null,
    canSeeFinance ? getDashboardSales() : null,
    canSeeStock ? getLowStockItems() : null,
    getRecentActivity(),
    getUserTasks(),
  ]);

  const actions: QuickAction[] = [
    ...(canSell ? [{ href: '/dashboard/sales/pos', label: 'ثبت فروش', icon: ShoppingCart }] : []),
    ...(canManageFinance
      ? [
          { href: '/dashboard/accounting/expenses/new', label: 'ثبت هزینه', icon: Receipt },
          { href: '/dashboard/accounting/deposits/new', label: 'ثبت واریز', icon: ArrowDownLeft },
          { href: '/dashboard/accounting/withdrawals/new', label: 'پرداخت جدید', icon: ArrowUpRight },
          { href: '/dashboard/accounting/transfers/new', label: 'انتقال داخلی', icon: ArrowLeftRight },
        ]
      : []),
    ...(canManageStock ? [{ href: '/dashboard/inventory/products/new', label: 'افزودن کالا', icon: PackagePlus }] : []),
    ...(canSell ? [{ href: '/dashboard/marketing/gifts/new', label: 'ثبت هدیه', icon: Gift }] : []),
    { href: '/dashboard/assistant', label: 'پرسش از دستیار', icon: Bot },
  ];

  // Today against yesterday, only when there was a yesterday to compare with.
  const change =
    sales && sales.yesterday.total > 0
      ? ((sales.today.total - sales.yesterday.total) / sales.yesterday.total) * 100
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="داشبورد"
        description="نمای کلی کسب‌وکار"
        actions={
          canSell && (
            <Button asChild>
              <Link href="/dashboard/sales/pos">
                <Plus className="h-4 w-4" />
                فروش جدید
              </Link>
            </Button>
          )
        }
      />

      {financials && sales && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <FinancialCards financials={financials} />
          <KpiCard
            label="فروش امروز"
            icon={Zap}
            value={sales.today.total ? fa(sales.today.total) : '—'}
            unit={sales.today.total ? 'تومان' : undefined}
            delta={
              change === null
                ? undefined
                : {
                    text: `${change > 0 ? '+' : ''}${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(change)}٪`,
                    tone: change > 0 ? 'pos' : change < 0 ? 'neg' : 'neu',
                  }
            }
            note={`${fa(sales.today.count)} سفارش · نسبت به دیروز`}
          />
          <KpiCard
            label="فروش دیروز"
            icon={ShoppingCart}
            value={sales.yesterday.total ? fa(sales.yesterday.total) : '—'}
            unit={sales.yesterday.total ? 'تومان' : undefined}
          />
        </div>
      )}

      <QuickActions actions={actions} />

      <div className="grid gap-4 lg:grid-cols-3">
        {sales && (
          <div className="lg:col-span-2">
            <SalesChart dailySales={sales.dailySales} reportHref={canSeeSales ? '/dashboard/reports/sales' : undefined} />
          </div>
        )}
        <div className={sales ? undefined : 'lg:col-span-3'}>
          <MyTasksWidget tasks={userTasks} />
        </div>
      </div>

      {(lowStockItems || sales) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {lowStockItems && (
            <div className={sales ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <LowStockAlert items={lowStockItems} />
            </div>
          )}
          {sales && (
            <div className={lowStockItems ? undefined : 'lg:col-span-3'}>
              <TopProducts products={sales.topProducts} />
            </div>
          )}
        </div>
      )}

      <RecentActivity activities={recentActivity} />
    </div>
  );
}
