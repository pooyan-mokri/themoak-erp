import { getAssets } from '@/actions/fixed-assets';
import { AssetList } from '@/components/inventory/asset-list';
import { AssetForm } from '@/components/inventory/asset-form';

export default async function AssetsPage() {
  const assets = await getAssets();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">دارایی‌های ثابت و مصرفی</h2>
        <p className="text-muted-foreground">
          مدیریت دارایی‌های ثابت و کالاهای مصرفی شرکت
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <AssetList assets={assets} />
        </div>
        <div className="md:col-span-1">
          <AssetForm />
        </div>
      </div>
    </div>
  );
}



