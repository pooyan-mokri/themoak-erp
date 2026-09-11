import { auth } from '@/auth';
import { getProductsWithoutWebId, getWebIdSeedPreview } from '@/actions/web-id';
import { WebIdManager } from '@/components/inventory/web-id-manager';

export default async function WebIdsPage() {
  const [preview, missing, session] = await Promise.all([
    getWebIdSeedPreview(),
    getProductsWithoutWebId(),
    auth(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">شناسه‌های سایت</h1>
        <p className="text-muted-foreground mt-1">
          سایت هر کالا را با «شناسهٔ سایت» پیدا می‌کند، نه با نام یا SKU. کالایی که شناسه ندارد در سایت
          فروخته نمی‌شود.
        </p>
      </div>
      <WebIdManager preview={preview} missing={missing} isAdmin={session?.user?.role === 'ADMIN'} />
    </div>
  );
}
