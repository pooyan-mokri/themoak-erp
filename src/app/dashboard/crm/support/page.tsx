import { getTickets } from '@/actions/crm';
import { TicketList } from '@/components/crm/ticket-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function SupportPage() {
  await requireRouteAccess('/dashboard/crm');
  const [tickets, canManage] = await Promise.all([getTickets(), hasPermission('sales.manage')]);
  const open = tickets.filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="پشتیبانی مشتریان"
        description={`${open.toLocaleString('fa-IR')} تیکت باز یا در حال بررسی از ${tickets.length.toLocaleString('fa-IR')}`}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/crm/support/new">
                <Plus className="h-4 w-4" />
                تیکت جدید
              </Link>
            </Button>
          )
        }
      />

      <TicketList tickets={tickets} />
    </div>
  );
}
