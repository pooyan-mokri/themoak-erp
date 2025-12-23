import { getProducts } from '@/actions/product';
import { getWarehouses } from '@/actions/warehouse';
import { AdjustmentForm } from '@/components/inventory/adjustment-form';

export default async function AdjustmentsPage() {
  const products = await getProducts();
  const warehouses = await getWarehouses();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تنظیم موجودی انبار</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <AdjustmentForm products={products} warehouses={warehouses} />
        </div>
        <div className="bg-muted/50 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">راهنما</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>برای افزایش موجودی، مقدار مثبت وارد کنید (مثال: 10).</li>
            <li>برای کاهش موجودی، مقدار منفی وارد کنید (مثال: -5).</li>
            <li>این تغییرات بلافاصله در موجودی انبار اعمال می‌شوند.</li>
            <li>برای انتقال کالا بین انبارها، از بخش انتقال موجودی استفاده کنید.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
