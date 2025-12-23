import { getDeals } from '@/actions/crm';
import { DealKanban } from '@/components/crm/deal-kanban';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default async function DealsPage() {
  const deals = await getDeals();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">فرصت‌های فروش</h2>
          <p className="text-muted-foreground">مدیریت پایپلاین فروش</p>
        </div>
        <Link href="/dashboard/crm/deals/new">
          <Button>
            <Plus className="h-4 w-4 ml-2" />
            فرصت جدید
          </Button>
        </Link>
      </div>

      <DealKanban deals={deals} />
    </div>
  );
}
