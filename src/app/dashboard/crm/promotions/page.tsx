import { getPromotions } from '@/actions/promotion';
import { PromotionList } from '@/components/crm/promotion-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function PromotionsPage() {
  await requireRouteAccess('/dashboard/crm');
  const [promotions, canManage] = await Promise.all([getPromotions(), hasPermission('sales.manage')]);
  const active = promotions.filter((p: any) => p.isActive).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="کدهای تخفیف و کمپین‌ها"
        description={`${active.toLocaleString('fa-IR')} کد فعال از ${promotions.length.toLocaleString('fa-IR')}`}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/crm/promotions/new">
                <Plus className="h-4 w-4" />
                کد تخفیف جدید
              </Link>
            </Button>
          )
        }
      />

      <PromotionList promotions={promotions} canManage={canManage} />
    </div>
  );
}
