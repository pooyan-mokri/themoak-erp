import { getLeads } from '@/actions/crm';
import { LeadList } from '@/components/crm/lead-list';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default async function LeadsPage() {
  const leads = await getLeads();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">سرنخ‌ها</h2>
          <p className="text-muted-foreground">مدیریت سرنخ‌های فروش</p>
        </div>
        <Link href="/dashboard/crm/leads/new">
          <Button>
            <Plus className="h-4 w-4 ml-2" />
            سرنخ جدید
          </Button>
        </Link>
      </div>

      <LeadList leads={leads} />
    </div>
  );
}
