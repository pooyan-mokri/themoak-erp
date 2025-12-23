import { getCustomersWithDebt } from '@/actions/customer';
import { CRMCustomerList } from '@/components/crm/customer-list';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default async function CRMCustomersPage() {
  const customers = await getCustomersWithDebt();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">لیست مشتریان</h2>
        <Link href="/dashboard/crm/customers/new">
          <Button>
            <Plus className="h-4 w-4 ml-2" />
            مشتری جدید
          </Button>
        </Link>
      </div>

      <CRMCustomerList customers={customers} />
    </div>
  );
}
