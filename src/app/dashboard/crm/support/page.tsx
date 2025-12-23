import { getTickets } from '@/actions/crm';
import { TicketList } from '@/components/crm/ticket-list';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default async function SupportPage() {
  const tickets = await getTickets();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">پشتیبانی مشتریان</h2>
          <p className="text-muted-foreground">مدیریت تیکت‌های پشتیبانی</p>
        </div>
        <Link href="/dashboard/crm/support/new">
          <Button>
            <Plus className="h-4 w-4 ml-2" />
            تیکت جدید
          </Button>
        </Link>
      </div>

      <TicketList tickets={tickets} />
    </div>
  );
}
