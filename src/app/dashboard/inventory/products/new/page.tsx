import { ProductForm } from '@/components/inventory/product-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewProductPage() {
  await requireRouteAccess('/dashboard/inventory');
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">تعریف کالای جدید</h1>
      <ProductForm />
    </div>
  );
}
