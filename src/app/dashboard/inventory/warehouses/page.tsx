import { getWarehouses } from '@/actions/warehouse';
import { WarehouseForm } from '@/components/inventory/warehouse-form';
import { WarehouseList } from '@/components/inventory/warehouse-list';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Archive } from 'lucide-react';

export default async function WarehousesPage() {
  const warehouses = await getWarehouses();
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  // Total stock per warehouse (sum of inventory quantities)
  const stockGroups = await prisma.inventory.groupBy({
    by: ['warehouseId'],
    _sum: { quantity: true },
  });
  const stockByWarehouse: Record<string, number> = {};
  stockGroups.forEach((g: any) => {
    stockByWarehouse[g.warehouseId] = g._sum.quantity ?? 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">مدیریت انبارها</h1>
        <Link href="/dashboard/inventory/warehouses/archived">
          <Button variant="outline" size="sm">
            <Archive className="h-4 w-4 ml-2" />
            انبارهای آرشیو شده
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <WarehouseForm />
        </div>
        <div className="md:col-span-2">
          <WarehouseList warehouses={warehouses} isAdmin={isAdmin} stockByWarehouse={stockByWarehouse} />
        </div>
      </div>
    </div>
  );
}
