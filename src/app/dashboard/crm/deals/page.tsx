import { getDeals } from '@/actions/crm';
import { DealKanban } from '@/components/crm/deal-kanban';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));

export default async function DealsPage() {
  await requireRouteAccess('/dashboard/crm');
  const [deals, canManage] = await Promise.all([getDeals(), hasPermission('sales.manage')]);
  const open = deals.filter((d: any) => d.stage !== 'WON' && d.stage !== 'LOST');

  return (
    <div className="space-y-4">
      <PageHeader
        title="فرصت‌های فروش"
        description={`${fa(open.length)} فرصت باز به ارزش ${fa(open.reduce((sum: number, d: any) => sum + Number(d.value), 0))} تومان${canManage ? ' · کارت‌ها را بین مرحله‌ها بکشید' : ''}`}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/crm/deals/new">
                <Plus className="h-4 w-4" />
                فرصت جدید
              </Link>
            </Button>
          )
        }
      />

      <DealKanban deals={deals} canManage={canManage} />
    </div>
  );
}
