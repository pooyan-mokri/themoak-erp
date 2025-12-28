import { getCustomers } from '@/actions/customer';
import { DealForm } from '@/components/crm/deal-form';

export default async function NewDealPage() {
  const customers = await getCustomers();

  return (
    <div className="max-w-2xl mx-auto">
      <DealForm customers={customers.map((c: any) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
