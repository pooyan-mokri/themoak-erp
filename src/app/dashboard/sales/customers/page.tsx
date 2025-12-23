import { getCustomers } from '@/actions/customer';
import { CustomerForm } from '@/components/sales/customer-form';
import { CustomerList } from '@/components/sales/customer-list';

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت مشتریان</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <CustomerForm />
        </div>
        <div className="md:col-span-2">
          <CustomerList customers={customers} />
        </div>
      </div>
    </div>
  );
}
