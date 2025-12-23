import { getProducts } from '@/actions/product';
import { getAccounts } from '@/actions/accounting';
import { getMarketingCampaigns } from '@/actions/marketing';
import { getWarehouses } from '@/actions/warehouse';
import { GiftForm } from '@/components/marketing/gift-form';

// Filter only active campaigns
async function getActiveCampaigns() {
  const campaigns = await getMarketingCampaigns();
  return campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PLANNED');
}

export default async function NewGiftPage() {
  const [products, accounts, allCampaigns, warehouses] = await Promise.all([
    getProducts(),
    getAccounts(),
    getMarketingCampaigns(),
    getWarehouses(),
  ]);

  // Filter only active/planned campaigns
  const campaigns = allCampaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PLANNED');

  // Convert Decimal to number for client
  const productsWithNumbers = products.map((product) => ({
    ...product,
    costPrice: Number(product.costPrice || 0),
  }));

  const accountsWithNumbers = accounts.map((account) => ({
    ...account,
    balance: Number(account.balance),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ثبت هدیه بازاریابی</h1>
        <p className="text-muted-foreground mt-2">
          ثبت هدیه محصول به عنوان هزینه بازاریابی
        </p>
      </div>

      <GiftForm
        products={productsWithNumbers}
        accounts={accountsWithNumbers}
        campaigns={campaigns}
        warehouses={warehouses}
      />
    </div>
  );
}

