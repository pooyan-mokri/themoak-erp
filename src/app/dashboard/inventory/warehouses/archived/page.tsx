import { getArchivedWarehouses } from '@/actions/warehouse';
import { WarehouseArchivedList } from '@/components/inventory/warehouse-archived-list';
import { auth } from '@/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export default async function ArchivedWarehousesPage() {
  const warehouses = await getArchivedWarehouses();
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inventory/warehouses">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 ml-2 rotate-180" />
            بازگشت به انبارها
          </Button>
        </Link>
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">انبارهای آرشیو شده</h1>
        <p className="text-muted-foreground mt-1">
          این انبارها در فهرست‌ها و انتخاب‌ها نمایش داده نمی‌شوند. می‌توانید واردشان شوید، تاریخچه جابجایی‌شان را ببینید و در صورت نیاز بازگردانید.
        </p>
      </div>
      <WarehouseArchivedList warehouses={warehouses} isAdmin={isAdmin} />
    </div>
  );
}
