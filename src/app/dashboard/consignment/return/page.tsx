import { getConsignmentPartners } from '@/actions/consignment';
import { getWarehouses } from '@/actions/warehouse';
import { getProducts } from '@/actions/product';
import { ReturnForm } from '@/components/consignment/return-form';
import { requireRouteAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function ConsignmentReturnPage() {
  await requireRouteAccess('/dashboard/consignment');
  const [partners, warehouses, products] = await Promise.all([
    getConsignmentPartners(),
    getWarehouses(),
    getProducts(),
  ]);

  const targetWarehouses = warehouses.filter((w: any) => !w.isVirtual);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">برگشت کالای امانی</h1>
      <ReturnForm
        partners={partners}
        targetWarehouses={targetWarehouses}
        products={products}
      />
    </div>
  );
}
