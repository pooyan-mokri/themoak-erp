import { getPromotions } from '@/actions/promotion';
import { PromotionList } from '@/components/crm/promotion-list';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default async function PromotionsPage() {
  const promotions = await getPromotions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">کدهای تخفیف و کمپین‌ها</h2>
        <Link href="/dashboard/crm/promotions/new">
          <Button>
            <Plus className="h-4 w-4 ml-2" />
            کد تخفیف جدید
          </Button>
        </Link>
      </div>

      <PromotionList promotions={promotions} />
    </div>
  );
}
