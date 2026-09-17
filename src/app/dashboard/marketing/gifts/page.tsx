import { getMarketingGifts } from '@/actions/marketing';
import { GiftList } from '@/components/marketing/gift-list';
import { Button } from '@/components/ui/button';
import { Gift } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function GiftsPage() {
  await requireRouteAccess('/dashboard/marketing');
  const gifts = await getMarketingGifts();
  const canSeeCost = await hasPermission('cost.view');

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">تاریخچه هدایای بازاریابی</h1>
          <p className="text-muted-foreground mt-2">
            لیست تمام هدایای ثبت شده به عنوان هزینه بازاریابی
          </p>
        </div>
        <Link href="/dashboard/marketing/gifts/new">
          <Button>
            <Gift className="h-4 w-4 ml-2" />
            ثبت هدیه جدید
          </Button>
        </Link>
      </div>

      <GiftList gifts={giftsWithNumbers} canSeeCost={canSeeCost} />
    </div>
  );
}


