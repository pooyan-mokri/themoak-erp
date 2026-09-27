import { getLeads } from '@/actions/crm';
import { LeadList } from '@/components/crm/lead-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function LeadsPage() {
  await requireRouteAccess('/dashboard/crm');
  const [leads, canManage] = await Promise.all([getLeads(), hasPermission('sales.manage')]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="سرنخ‌ها"
        description={`${leads.length.toLocaleString('fa-IR')} سرنخ · مدیریت سرنخ‌های فروش`}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/dashboard/crm/leads/new">
                <Plus className="h-4 w-4" />
                سرنخ جدید
              </Link>
            </Button>
          )
        }
      />

      <LeadList leads={leads} />
    </div>
  );
}
