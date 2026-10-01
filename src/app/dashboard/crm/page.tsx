import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { faIR } from 'date-fns/locale';
import { Crown, Handshake, Plus, Ticket, TrendingUp, Users, Wallet } from 'lucide-react';
import { getCRMDashboardStats, getDeals, getLeads } from '@/actions/crm';
import { getCustomerOrderSummaries, getCustomers } from '@/actions/customer';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { Button } from '@/components/ui/button';
import { DEAL_STAGES, PILL, dealStage, fa, leadStatus } from '@/components/crm/crm-labels';
import { getCurrentRole, hasPermission, requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';
import { activityLabel } from '@/lib/activity-labels';

/**
 * CRM overview: customers, VIPs and what they bought (net of cancelled orders and
 * returns), the open pipeline by stage, lead conversion, open tickets, the best
 * customers, recent leads and — for an admin — recent activity.
 */
export default async function CRMDashboardPage() {
  await requireRouteAccess('/dashboard/crm');
  const [stats, customers, summaries, deals, leads, canManage, role] = await Promise.all([
    getCRMDashboardStats(),
    getCustomers(),
    getCustomerOrderSummaries(),
    getDeals(),
    getLeads(),
    hasPermission('sales.manage'),
    getCurrentRole(),
  ]);

  const valueOf = (id: string) => summaries[id]?.lifetimeValue ?? 0;
  const totalValue = customers.reduce((sum: number, c: any) => sum + valueOf(c.id), 0);
  const buyers = customers.filter((c: any) => (summaries[c.id]?.orders ?? 0) > 0).length;
  const vips = customers.filter((c: any) => c.segment === 'VIP');
  const vipValue = vips.reduce((sum: number, c: any) => sum + valueOf(c.id), 0);
  const converted = leads.filter((lead: any) => lead.customerId).length;
  const conversion = leads.length > 0 ? (converted / leads.length) * 100 : null;
  // The best customers by what they bought, from every customer (not the first five found).
  const top = [...customers]
    .filter((c: any) => valueOf(c.id) > 0)
    .sort((a: any, b: any) => valueOf(b.id) - valueOf(a.id))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <PageHeader
        title="مدیریت ارتباط با مشتری"
        description={`${fa(stats.totalCustomers)} مشتری · ${fa(stats.activeDealsCount)} فرصت فروش باز`}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href="/dashboard/crm/deals/new">
                  <Plus className="h-4 w-4" />
                  فرصت جدید
                </Link>
              </Button>
              <Button asChild>
                <Link href="/dashboard/crm/customers/new">
                  <Plus className="h-4 w-4" />
                  مشتری جدید
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="مشتریان" icon={Users} value={fa(stats.totalCustomers)} note={`${fa(buyers)} نفر با سفارش`} />
        <KpiCard
          label="مشتریان VIP"
          icon={Crown}
          value={fa(vips.length)}
          note={vips.length ? `ارزش خرید ${fa(vipValue)} تومان` : 'دستهٔ VIP به کسی داده نشده'}
        />
        <KpiCard label="ارزش خرید مشتریان" icon={Wallet} value={fa(totalValue)} unit="تومان" note="بدون لغوشده‌ها، پس از مرجوعی" />
        <KpiCard
          label="فرصت‌های باز"
          icon={Handshake}
          value={fa(stats.activeDealsValue)}
          unit="تومان"
          note={`${fa(stats.activeDealsCount)} فرصت فروش باز`}
        />
        <KpiCard
          label="نرخ تبدیل سرنخ"
          icon={TrendingUp}
          value={conversion === null ? '—' : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(conversion)}٪`}
          note={conversion === null ? 'سرنخی ثبت نشده' : `${fa(converted)} از ${fa(leads.length)} سرنخ مشتری شده`}
        />
        <KpiCard label="تیکت‌های بسته‌نشده" icon={Ticket} value={fa(stats.openTicketsCount)} note="باز، در حال بررسی یا حل‌شده" />
      </div>

      <SectionCard
        title="خط لوله فروش"
        count={fa(deals.length)}
        link={{ href: '/dashboard/crm/deals', label: 'تابلوی فرصت‌ها' }}
      >
        {deals.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            هنوز فرصت فروشی ثبت نشده است.{canManage && ' با «فرصت جدید» یک فرصت برای مشتری باز کنید.'}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {DEAL_STAGES.map((stage) => {
              const inStage = deals.filter((d: any) => d.stage === stage.id);
              const tone = dealStage(stage.id);
              return (
                <div key={stage.id} className="rounded-md bg-secondary p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn(PILL, tone.tone)}>{tone.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{fa(inStage.length)}</span>
                  </div>
                  <p className="mt-2 text-[15px] font-medium tabular-nums">
                    {fa(inStage.reduce((sum: number, d: any) => sum + Number(d.value), 0))}
                    <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {inStage.slice(0, 3).map((deal: any) => (
                      <li key={deal.id} className="rounded border bg-card px-2 py-1.5">
                        <Link href={`/dashboard/crm/deals/${deal.id}`} className="block truncate text-[12.5px] hover:text-brand">
                          {deal.title}
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">{deal.customer?.name}</p>
                      </li>
                    ))}
                    {inStage.length > 3 && (
                      <li className="text-[11.5px] text-muted-foreground">و {fa(inStage.length - 3)} فرصت دیگر</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="برترین مشتریان" link={{ href: '/dashboard/crm/customers', label: 'همه مشتریان' }}>
          {top.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">هنوز سفارشی به نام مشتری ثبت نشده است.</p>
          ) : (
            <ul className="divide-y">
              {top.map((customer: any, index: number) => (
                <li key={customer.id} className="flex items-center gap-3 py-2">
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-[11px]',
                      index === 0 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {fa(index + 1)}
                  </span>
                  <Link href={`/dashboard/crm/customers/${customer.id}`} className="min-w-0 flex-1 truncate text-[13.5px] hover:text-brand">
                    {customer.name}
                  </Link>
                  <span className="text-[12px] text-muted-foreground">{fa(summaries[customer.id]?.orders ?? 0)} سفارش</span>
                  <span className="w-32 text-end text-[13.5px] font-medium tabular-nums">{fa(valueOf(customer.id))}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="سرنخ‌های اخیر" link={{ href: '/dashboard/crm/leads', label: 'همه سرنخ‌ها' }}>
          {stats.recentLeads.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              سرنخی ثبت نشده است.{canManage && ' سرنخ‌ها را از بخش «سرنخ‌ها» اضافه کنید.'}
            </p>
          ) : (
            <ul className="divide-y">
              {stats.recentLeads.map((lead: any) => {
                const status = leadStatus(lead.status);
                return (
                  <li key={lead.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/crm/leads/${lead.id}`} className="block truncate text-[13.5px] hover:text-brand">
                        {lead.name}
                      </Link>
                      <p className="truncate text-[12px] text-muted-foreground">{lead.company || lead.email || lead.phone || '—'}</p>
                    </div>
                    <span className={cn(PILL, status.tone)}>{status.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="فعالیت‌های اخیر">
        {stats.recentActivity.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            {role === 'ADMIN' ? 'فعالیتی ثبت نشده است.' : 'فعالیت همهٔ کاربران فقط برای مدیر سیستم نمایش داده می‌شود.'}
          </p>
        ) : (
          <ul className="divide-y">
            {stats.recentActivity.map((activity: any) => (
              <li key={activity.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{activityLabel(activity.action)}</p>
                  <p className="text-[12px] text-muted-foreground">{activity.details}</p>
                  {activity.user && <p className="text-[11.5px] text-muted-foreground">توسط {activity.user.name}</p>}
                </div>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: faIR })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
