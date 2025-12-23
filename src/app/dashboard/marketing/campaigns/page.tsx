import { getMarketingCampaigns } from '@/actions/marketing';
import { CampaignForm } from '@/components/marketing/campaign-form';
import { CampaignList } from '@/components/marketing/campaign-list';

export default async function CampaignsPage() {
  const campaigns = await getMarketingCampaigns();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">کمپین‌های بازاریابی</h1>
        <p className="text-muted-foreground mt-2">
          ایجاد و مدیریت کمپین‌های بازاریابی
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CampaignForm />
        <CampaignList campaigns={campaigns} />
      </div>
    </div>
  );
}



