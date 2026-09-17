import { SupplierForm } from '@/components/suppliers/supplier-form';
import { requireRouteAccess } from '@/lib/access';

export default async function NewSupplierPage() {
  await requireRouteAccess('/dashboard/suppliers');
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تامین‌کننده جدید</h1>
      <SupplierForm />
    </div>
  );
}
