import { getMarketingCampaigns } from '@/actions/marketing';
import { CampaignForm } from '@/components/marketing/campaign-form';
import { CampaignList } from '@/components/marketing/campaign-list';
import { PageHeader } from '@/components/layout/page-header';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

export default async function CampaignsPage() {
  await requireRouteAccess('/dashboard/marketing');
  const [campaigns, canManage] = await Promise.all([getMarketingCampaigns(), hasPermission('sales.manage')]);
  const active = campaigns.filter((c: any) => c.status === 'ACTIVE').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="کمپین‌های بازاریابی"
        description={`${active.toLocaleString('fa-IR')} کمپین فعال از ${campaigns.length.toLocaleString('fa-IR')} · ایجاد و مدیریت کمپین‌ها`}
      />

      <div className={cn('grid gap-4', canManage && 'lg:grid-cols-[1fr_420px]')}>
        <CampaignList campaigns={campaigns} />
        {canManage && <CampaignForm />}
      </div>
    </div>
  );
}
