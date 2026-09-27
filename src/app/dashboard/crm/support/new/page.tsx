import { getCustomers } from '@/actions/customer';
import { TicketForm } from '@/components/crm/ticket-form';
import { requireRouteAccess } from '@/lib/access';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewTicketPage() {
  await requireRouteAccess('/dashboard/crm');
  const customers = await getCustomers();
  
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="تیکت جدید" description="ایجاد تیکت پشتیبانی برای مشتری" />
      <TicketForm customers={customers} />
    </div>
  );
}
