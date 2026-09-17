import { getWarehouses } from '@/actions/warehouse';
import { WarehouseForm } from '@/components/inventory/warehouse-form';
import { WarehouseList } from '@/components/inventory/warehouse-list';
import { prisma } from '@/lib/prisma';
import { DEFAULT_SITE_WAREHOUSE_NAME, pickWithDefault, readSiteConnection } from '@/lib/site-connection';
import { auth } from '@/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Archive } from 'lucide-react';
import { requireRouteAccess } from '@/lib/access';

export default async function WarehousesPage() {
  await requireRouteAccess('/dashboard/inventory');
  const warehouses = await getWarehouses();
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  // Total stock per warehouse (sum of inventory quantities). Min/max reveal a
  // non-zero row inside a zero sum (+4 of one product, -4 of another), which
  // still blocks archiving and deleting.
  const stockGroups = await prisma.inventory.groupBy({
    by: ['warehouseId'],
    _sum: { quantity: true },
    _min: { quantity: true },
    _max: { quantity: true },
  });
  const stockByWarehouse: Record<string, number> = {};
  const nonZeroStock: Record<string, boolean> = {};
  stockGroups.forEach((g: any) => {
    stockByWarehouse[g.warehouseId] = g._sum.quantity ?? 0;
    nonZeroStock[g.warehouseId] = (g._min.quantity ?? 0) < 0 || (g._max.quantity ?? 0) > 0;
  });

  // The website's warehouse cannot be archived or deleted either; resolved like
  // the site connection settings page (src/actions/site-connection.ts).
  const [siteConnection, siteWarehouses] = await Promise.all([
    readSiteConnection(prisma),
    prisma.warehouse.findMany({
      where: { isArchived: false, isVirtual: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const siteWarehouseId = pickWithDefault(siteWarehouses, siteConnection.warehouseId, DEFAULT_SITE_WAREHOUSE_NAME);

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
          <WarehouseList
            warehouses={warehouses}
            isAdmin={isAdmin}
            stockByWarehouse={stockByWarehouse}
            nonZeroStock={nonZeroStock}
            siteWarehouseId={siteWarehouseId}
          />
        </div>
      </div>
    </div>
  );
}
