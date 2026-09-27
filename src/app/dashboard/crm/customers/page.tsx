import { getCustomerOrderSummaries, getCustomersWithDebt } from '@/actions/customer';
import { CRMCustomerList } from '@/components/crm/customer-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));

export default async function CRMCustomersPage() {
  await requireRouteAccess('/dashboard/crm');
  const [customers, summaries, canManage] = await Promise.all([
    getCustomersWithDebt(),
    getCustomerOrderSummaries(),
    hasPermission('sales.manage'),
  ]);
  const value = Object.values(summaries).reduce((sum, s) => sum + s.lifetimeValue, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="مشتریان"
        description={`${fa(customers.length)} مشتری · ارزش خرید ${fa(value)} تومان، بدون سفارش‌های لغوشده و پس از مرجوعی`}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/crm/customers/new">
                <Plus className="h-4 w-4" />
                مشتری جدید
              </Link>
            </Button>
          )
        }
      />

      <CRMCustomerList customers={customers} summaries={summaries} canManage={canManage} />
    </div>
  );
}
