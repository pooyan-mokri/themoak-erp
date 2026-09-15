import { auth } from '@/auth';
import { countNonStandardBarcodes } from '@/actions/product';
import { getWarehouses } from '@/actions/warehouse';
import { BackButton } from '@/components/ui/back-button';
import { BarcodeLabelsView } from '@/components/inventory/barcode-labels-view';

// Replacing non-standard barcodes runs from this page: one write per product.
export const maxDuration = 60;

export default async function ProductLabelsPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  const [warehouses, nonStandardCount] = await Promise.all([
    getWarehouses(),
    isAdmin ? countNonStandardBarcodes() : Promise.resolve(0),
  ]);

  return (
    <div>
      {/* No space-y on this wrapper: a hidden header must not push the first printed label down. */}
      <div className="mb-6 space-y-2 print:hidden">
        <BackButton href="/dashboard/inventory/products" label="بازگشت به لیست محصولات" />
        <h1 className="text-3xl font-bold tracking-tight">چاپ گروهی برچسب بارکد</h1>
      </div>

      <BarcodeLabelsView
        warehouses={warehouses
          .filter((w: any) => !w.isVirtual && !w.isArchived)
          .map((w: any) => ({ id: w.id, name: w.name }))}
        isAdmin={isAdmin}
        initialNonStandardCount={nonStandardCount}
      />
    </div>
  );
}
