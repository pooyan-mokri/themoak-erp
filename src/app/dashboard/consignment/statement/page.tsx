import { getConsignmentPartners } from '@/actions/consignment';
import { PartnerStatementView } from '@/components/consignment/partner-statement-view';
import { requireRouteAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function PartnerStatementPage() {
  await requireRouteAccess('/dashboard/consignment');
  const partners = await getConsignmentPartners();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">کارت حساب همکار امانی</h1>
      <PartnerStatementView partners={partners} />
    </div>
  );
}
