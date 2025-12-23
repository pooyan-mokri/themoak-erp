import { getConsignmentPartners } from '@/actions/consignment';
import { PartnerForm } from '@/components/consignment/partner-form';
import { PartnerList } from '@/components/consignment/partner-list';

export default async function PartnersPage() {
  const partners = await getConsignmentPartners();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت همکاران امانی</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <PartnerForm />
        </div>
        <div className="md:col-span-2">
          <PartnerList partners={partners} />
        </div>
      </div>
    </div>
  );
}
