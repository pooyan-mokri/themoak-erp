import { getCustomers } from '@/actions/customer';
import { TicketForm } from '@/components/crm/ticket-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewTicketPage() {
  await requireRouteAccess('/dashboard/crm');
  const customers = await getCustomers();
  
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">تیکت جدید</h2>
        <p className="text-muted-foreground">ایجاد تیکت پشتیبانی برای مشتری</p>
      </div>
      <TicketForm customers={customers} />
    </div>
  );
}
