import { getMarketingGifts } from '@/actions/marketing';
import { GiftList } from '@/components/marketing/gift-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Gift } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function GiftsPage() {
  await requireRouteAccess('/dashboard/marketing');
  const gifts = await getMarketingGifts();
  const [canSeeCost, canManage] = await Promise.all([hasPermission('cost.view'), hasPermission('sales.manage')]);

  // Convert dates and numbers (the cost is absent without cost.view)
  const giftsWithNumbers = gifts.map((gift: any) =>
    canSeeCost
      ? {
          ...gift,
          costPrice: Number(gift.costPrice || 0),
          totalCost: Number(gift.totalCost || 0),
        }
      : gift,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="تاریخچه هدایای بازاریابی"
        description="لیست تمام هدایای ثبت شده به عنوان هزینه بازاریابی"
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/marketing/gifts/new">
                <Gift className="h-4 w-4" />
                ثبت هدیه جدید
              </Link>
            </Button>
          )
        }
      />

      <GiftList gifts={giftsWithNumbers} canSeeCost={canSeeCost} />
    </div>
  );
}
