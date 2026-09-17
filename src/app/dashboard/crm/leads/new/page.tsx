import { LeadForm } from '@/components/crm/lead-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewLeadPage() {
  await requireRouteAccess('/dashboard/crm');
  return (
    <div className="max-w-2xl mx-auto">
      <LeadForm />
    </div>
  );
}
