import { CustomerForm } from '@/components/sales/customer-form';
import { getLeadById } from '@/actions/crm';
import { redirect } from 'next/navigation';

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: { leadId?: string };
}) {
  let initialData = null;

  if (searchParams.leadId) {
    const lead = await getLeadById(searchParams.leadId);
    if (lead) {
      initialData = {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        // We can't pass ID because that would trigger update mode
        // We just want to pre-fill
      };
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <CustomerForm 
        initialData={initialData} 
        onSuccess={async () => {
          'use server';
          redirect('/dashboard/crm/customers');
        }} 
      />
    </div>
  );
}
