import { getProducts } from '@/actions/product';
import { getAccountOptions } from '@/actions/account-options';
import { getMarketingCampaigns } from '@/actions/marketing';
import { getWarehouses } from '@/actions/warehouse';
import { GiftForm } from '@/components/marketing/gift-form';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { PageHeader } from '@/components/layout/page-header';

// Filter only active campaigns
async function getActiveCampaigns() {
  const campaigns = await getMarketingCampaigns();
  return campaigns.filter((c: any) => c.status === 'ACTIVE' || c.status === 'PLANNED');
}

export default async function NewGiftPage() {
  await requireRouteAccess('/dashboard/marketing');
  const [products, accounts, allCampaigns, warehouses, canSeeCost] = await Promise.all([
    getProducts(),
    getAccountOptions(),
    getMarketingCampaigns(),
    getWarehouses(),
    hasPermission('cost.view'),
  ]);

  // Filter only active/planned campaigns
  const campaigns = allCampaigns.filter((c: any) => c.status === 'ACTIVE' || c.status === 'PLANNED');

  // Convert Decimal to number for client
  const productsWithNumbers = products.map((product: any) =>
    canSeeCost ? { ...product, costPrice: Number(product.costPrice || 0) } : product,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="ثبت هدیه بازاریابی"
        description="کالا از انبار انتخابی کم و بهای تمام‌شده‌اش روی حساب هزینهٔ انتخابی به‌عنوان هزینه بازاریابی ثبت می‌شود"
      />

      <GiftForm
        products={productsWithNumbers}
        accounts={accounts}
        campaigns={campaigns}
        warehouses={warehouses}
        canSeeCost={canSeeCost}
      />
    </div>
  );
}

