import { getInventoryByWarehouse } from '@/actions/inventory';
import { getWarehouseById } from '@/actions/warehouse';
import { StockList } from '@/components/inventory/stock-list';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function WarehouseDetailsPage({ params }: { params: { id: string } }) {
  const [warehouse, inventory] = await Promise.all([
    getWarehouseById(params.id),
    getInventoryByWarehouse(params.id),
  ]);

  if (!warehouse) {
    notFound();
  }

  const totalItems = inventory.reduce((sum: any, item: any) => sum + item.quantity, 0);
  const totalValue = inventory.reduce((sum: any, item: any) => sum + (item.quantity * Number(item.product.costPrice)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/inventory/console">
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{warehouse.name}</h2>
          <p className="text-muted-foreground">
            {warehouse.isVirtual ? 'انبار مجازی (امانی)' : 'انبار فیزیکی'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="p-6 bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">تعداد اقلام</div>
          <div className="text-2xl font-bold mt-2">{totalItems}</div>
        </div>
        <div className="p-6 bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">ارزش موجودی</div>
          <div className="text-2xl font-bold mt-2">
            {new Intl.NumberFormat('fa-IR').format(totalValue)} <span className="text-xs font-normal text-muted-foreground">تومان</span>
          </div>
        </div>
        <div className="p-6 bg-white dark:bg-slate-950 rounded-lg border shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">تنوع کالا</div>
          <div className="text-2xl font-bold mt-2">{inventory.length}</div>
        </div>
      </div>

      <StockList inventory={inventory} />
    </div>
  );
}
