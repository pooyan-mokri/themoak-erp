import { getCustomerById } from '@/actions/customer';
import { EditCustomerWrapper } from '@/components/crm/edit-customer-wrapper';
import { notFound } from 'next/navigation';
import { requireRouteAccess } from '@/lib/access';
import { PageHeader } from '@/components/layout/page-header';

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/crm');
  const customer = await getCustomerById(params.id);

  if (!customer) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="ویرایش مشتری" description={customer.name} />
      <EditCustomerWrapper customer={customer} />
    </div>
  );
}
