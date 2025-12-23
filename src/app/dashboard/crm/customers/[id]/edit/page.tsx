import { getCustomerById } from '@/actions/customer';
import { EditCustomerWrapper } from '@/components/crm/edit-customer-wrapper';
import { notFound } from 'next/navigation';

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  const customer = await getCustomerById(params.id);

  if (!customer) {
    notFound();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">ویرایش مشتری</h2>
      <EditCustomerWrapper customer={customer} />
    </div>
  );
}
