import { getProducts } from '@/actions/product';
import { ProductTable } from '@/components/inventory/product-table';
import { Button } from '@/components/ui/button';
import { Barcode, Plus } from 'lucide-react';
import Link from 'next/link';

import { ProductActions } from '@/components/inventory/product-actions';
import { hasPermission, requireRouteAccess } from '@/lib/access';

export default async function ProductsPage() {
  await requireRouteAccess('/dashboard/inventory');
  const [products, canSeeCost, canSeeSellPrice, canEditCost, canManage, canManageFinance] = await Promise.all([
    getProducts(),
    hasPermission('cost.view'),
    hasPermission('sales.view'),
    hasPermission('cost.edit'),
    hasPermission('stock.manage'),
    hasPermission('finance.manage'),
  ]);
  // A gift takes stock and books an expense: giftProduct needs both.
  const canGift = canManage && canManageFinance;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">تعریف کالا</h1>
        <div className="flex gap-2">
          <ProductActions products={products} canSeeCost={canSeeCost} canSeeSellPrice={canSeeSellPrice} canManage={canManage} />
          <Link href="/dashboard/inventory/products/labels">
            <Button variant="outline">
              <Barcode className="mr-2 h-4 w-4" /> چاپ گروهی بارکد
            </Button>
          </Link>
          <Link href="/dashboard/inventory/web-ids">
            <Button variant="outline">شناسه‌های سایت</Button>
          </Link>
          <Link href="/dashboard/inventory/products/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> افزودن کالا
            </Button>
          </Link>
        </div>
      </div>
      <ProductTable
        products={products}
        canSeeCost={canSeeCost}
        canSeeSellPrice={canSeeSellPrice}
        canEditCost={canEditCost}
        canManage={canManage}
        canGift={canGift}
      />
    </div>
  );
}
