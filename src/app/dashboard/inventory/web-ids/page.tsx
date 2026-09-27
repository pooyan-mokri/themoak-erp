import Link from 'next/link';
import { auth } from '@/auth';
import { getProductsWithoutWebId, getWebIdSeedPreview } from '@/actions/web-id';
import { WebIdManager } from '@/components/inventory/web-id-manager';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { requireRouteAccess } from '@/lib/access';

export default async function WebIdsPage() {
  await requireRouteAccess('/dashboard/inventory');
  const [preview, missing, session] = await Promise.all([
    getWebIdSeedPreview(),
    getProductsWithoutWebId(),
    auth(),
  ]);
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      <PageHeader
        title="شناسه‌های سایت"
        description="سایت هر کالا را با «شناسهٔ سایت» پیدا می‌کند، نه با نام یا SKU. کالایی که شناسه ندارد در سایت فروخته نمی‌شود."
        actions={
          isAdmin && (
            <Button asChild variant="outline">
              <Link href="/dashboard/settings/site">اتصال سایت</Link>
            </Button>
          )
        }
      />
      <WebIdManager preview={preview} missing={missing} isAdmin={isAdmin} />
    </div>
  );
}
