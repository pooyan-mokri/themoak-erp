'use client';

import { CustomerForm } from '@/components/sales/customer-form';
import { useRouter } from 'next/navigation';

export function EditCustomerWrapper({ customer }: { customer: any }) {
  const router = useRouter();

  return (
    <CustomerForm 
      initialData={customer} 
      onSuccess={() => router.push(`/dashboard/crm/customers/${customer.id}`)} 
    />
  );
}
