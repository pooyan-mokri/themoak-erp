import { PromotionForm } from '@/components/crm/promotion-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewPromotionPage() {
  await requireRouteAccess('/dashboard/crm');
  return (
    <div className="max-w-2xl mx-auto">
      <PromotionForm />
    </div>
  );
}
