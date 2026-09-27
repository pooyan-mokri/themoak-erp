import Link from 'next/link';
import { ArrowLeft, BarChart3, LineChart, Package, TrendingUp, type LucideIcon } from 'lucide-react';
import { getSalesTimeline } from '@/actions/sales-timeline';
import { PageHeader } from '@/components/layout/page-header';
import { PrintButton } from '@/components/reports/print-button';
import { RangeSwitch } from '@/components/reports/range-switch';
import { SalesOverview } from '@/components/reports/sales-overview';
import { jalaliFull, parseRange, reportWindow, summarizeSales } from '@/components/reports/report-window';
import { hasPermission, requireRouteAccess } from '@/lib/access';

type ReportLink = { href: string; label: string; description: string; icon: LucideIcon };

/**
 * The reports hub: the detailed reports this role may open, and — for a role that
 * sees sales — an overview of the chosen range against the period before it.
 */
export default async function ReportsPage({ searchParams }: { searchParams: { range?: string } }) {
  await requireRouteAccess('/dashboard/reports');
  const [canSeeSales, canSeeFinance, canSeeCost, canSeeProfit] = await Promise.all([
    hasPermission('sales.view'),
    hasPermission('finance.view'),
    hasPermission('cost.view'),
    hasPermission('profit.view'),
  ]);

  const range = parseRange(searchParams.range) ?? '12w';
  const period = reportWindow(range);
  const [current, previous] = canSeeSales
    ? await Promise.all([
        getSalesTimeline(new Date(period.start), new Date(period.end)),
        getSalesTimeline(new Date(period.prevStart), new Date(period.prevEnd)),
      ])
    : [[], []];

  const links: ReportLink[] = [
    ...(canSeeSales
      ? [{ href: '/dashboard/reports/sales', label: 'گزارش فروش', description: 'فروش بر اساس محصول، مشتری و زمان', icon: BarChart3 }]
      : []),
    ...(canSeeFinance
      ? [{ href: '/dashboard/sales/analytics', label: 'تحلیل و پیش‌بینی فروش', description: '۹۰ روز گذشته و پیش‌بینی ۷ روز آینده', icon: LineChart }]
      : []),
    ...(canSeeCost
      ? [{ href: '/dashboard/reports/inventory', label: 'گزارش موجودی', description: 'گردش موجودی و قدمت کالا', icon: Package }]
      : []),
    ...(canSeeProfit
      ? [{ href: '/dashboard/reports/financial', label: 'گزارش‌های مالی', description: 'سود و زیان و ترازنامه', icon: TrendingUp }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارشات"
        description={
          canSeeSales ? (
            <>
              {period.label} · <span className="font-mono text-[12px]">{jalaliFull(period.start)}</span> تا{' '}
              <span className="font-mono text-[12px]">{jalaliFull(period.end)}</span>
            </>
          ) : (
            'گزارش‌هایی که نقش شما می‌تواند ببیند'
          )
        }
        actions={
          <>
            {canSeeSales && <RangeSwitch basePath="/dashboard/reports" active={range} />}
            <PrintButton />
          </>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-3 rounded-lg border bg-card px-3.5 py-3 transition-colors duration-150 hover:border-brand"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
              <link.icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{link.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{link.description}</span>
            </span>
            <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-brand" />
          </Link>
        ))}
      </div>

      {canSeeSales ? (
        <SalesOverview period={period} summary={summarizeSales(period, current, previous)} />
      ) : (
        <p className="rounded-lg border bg-card p-4 text-[13px] text-muted-foreground">
          خلاصهٔ فروش برای نقش‌هایی نمایش داده می‌شود که فروش را می‌بینند. گزارش‌های بالا را باز کنید.
        </p>
      )}
    </div>
  );
}
