import { ProductForm } from '@/components/inventory/product-form';

export default function NewProductPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">تعریف کالای جدید</h1>
      <ProductForm />
    </div>
  );
}
