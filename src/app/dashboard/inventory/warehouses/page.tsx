import { getWarehouses } from '@/actions/warehouse';
import { WarehouseForm } from '@/components/inventory/warehouse-form';
import { WarehouseList } from '@/components/inventory/warehouse-list';

export default async function WarehousesPage() {
  const warehouses = await getWarehouses();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت انبارها</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <WarehouseForm />
        </div>
        <div className="md:col-span-2">
          <WarehouseList warehouses={warehouses} />
        </div>
      </div>
    </div>
  );
}
