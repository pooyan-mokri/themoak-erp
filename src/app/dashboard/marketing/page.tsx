import Link from 'next/link';
import { Gift, Megaphone, Package, Wallet } from 'lucide-react';
import { getMarketingCampaigns, getMarketingStats } from '@/actions/marketing';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { Button } from '@/components/ui/button';
import { CampaignList } from '@/components/marketing/campaign-list';
import { fa } from '@/components/marketing/marketing-labels';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/** Marketing: gifts and their cost, campaigns and their budget, the live campaigns and the most gifted products. */
export default async function MarketingPage() {
  await requireRouteAccess('/dashboard/marketing');
  const [stats, campaigns, canManage] = await Promise.all([
    getMarketingStats(),
    getMarketingCampaigns(),
    hasPermission('sales.manage'),
  ]);
  const live = campaigns.filter((c: any) => c.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      <PageHeader
        title="بازاریابی"
        description="مدیریت هدایای بازاریابی و کمپین‌ها"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/marketing/campaigns">
                <Megaphone className="h-4 w-4" />
                کمپین‌ها
              </Link>
            </Button>
            {canManage && (
              <Button asChild>
                <Link href="/dashboard/marketing/gifts/new">
                  <Gift className="h-4 w-4" />
                  ثبت هدیه
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="کل هدایا" icon={Gift} value={fa(stats.totalGifts)} note={`${fa(stats.totalQuantity)} عدد محصول`} />
        {stats.totalCost !== null && (
          <KpiCard label="کل هزینه" icon={Wallet} value={fa(stats.totalCost)} unit="تومان" note="بهای تمام‌شدهٔ هدایا" />
        )}
        <KpiCard
          label="کمپین‌های فعال"
          icon={Megaphone}
          value={fa(stats.activeCampaigns)}
          note={`از ${fa(stats.totalCampaigns)} کمپین`}
        />
        {stats.remainingBudget !== null && (
          <KpiCard
            label="بودجه باقیمانده"
            icon={Package}
            value={fa(stats.remainingBudget)}
            unit="تومان"
            note={`از ${fa(stats.totalBudget)} تومان بودجه کل`}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <SectionCard
          title="کمپین‌های فعال"
          count={fa(live.length)}
          link={{ href: '/dashboard/marketing/campaigns', label: 'همه کمپین‌ها' }}
        >
          {live.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              کمپین فعالی نیست.{canManage && ' از بخش «کمپین‌ها» یکی بسازید یا وضعیتش را فعال کنید.'}
            </p>
          ) : (
            <CampaignList campaigns={live} compact />
          )}
        </SectionCard>

        <SectionCard title="پرهدیه‌ترین کالاها" link={{ href: '/dashboard/marketing/gifts', label: 'تاریخچه هدایا' }}>
          {stats.giftsByProduct.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">هنوز هدیه‌ای ثبت نشده است.</p>
          ) : (
            <ul className="divide-y">
              {stats.giftsByProduct.map((row: any, index: number) => (
                <li key={row.name} className="flex items-center gap-3 py-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-secondary font-mono text-[11px] text-muted-foreground">
                    {(index + 1).toLocaleString('fa-IR')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" dir="ltr" style={{ textAlign: 'start' }}>
                    {row.name}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{fa(row.quantity)} عدد</span>
                  {row.cost !== null && <span className="w-24 text-end text-[13px] font-medium tabular-nums">{fa(row.cost)}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
