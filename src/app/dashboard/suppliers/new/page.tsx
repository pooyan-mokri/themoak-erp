import { SupplierForm } from '@/components/suppliers/supplier-form';

export default function NewSupplierPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تامین‌کننده جدید</h1>
      <SupplierForm />
    </div>
  );
}
