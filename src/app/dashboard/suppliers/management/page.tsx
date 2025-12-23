import { getSuppliers } from '@/actions/supplier';
import { SupplierList } from '@/components/suppliers/supplier-list';

export default async function SuppliersManagementPage() {
  const { data: suppliers, error } = await getSuppliers();

  if (error) {
    return (
      <div className="p-4 text-red-500 bg-red-50 rounded-md">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت تامین‌کنندگان</h1>
      <SupplierList suppliers={suppliers || []} />
    </div>
  );
}
