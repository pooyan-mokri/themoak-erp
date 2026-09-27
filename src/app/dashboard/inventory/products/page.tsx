import { getProducts } from '@/actions/product';
import { getWarehouses } from '@/actions/warehouse';
import { getInventoryByWarehouse } from '@/actions/inventory';
import { ProductTable, type ProductStock } from '@/components/inventory/product-table';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/**
 * Units per product, read warehouse by warehouse with the inventory action: every warehouse counts
 * toward the total (as on the product page), the physical ones toward what can be sold.
 */
async function stockByProduct(): Promise<Record<string, ProductStock> | null> {
  try {
    const warehouses = await getWarehouses(true);
    const rows = await Promise.all(warehouses.map((w: any) => getInventoryByWarehouse(w.id)));
    const stock: Record<string, ProductStock> = {};
    warehouses.forEach((warehouse: any, index: number) => {
      for (const row of rows[index] as Array<{ productId: string; quantity: number }>) {
        const entry = (stock[row.productId] ??= { total: 0, sellable: 0 });
        entry.total += row.quantity;
        if (!warehouse.isVirtual) entry.sellable += row.quantity;
      }
    });
    return stock;
  } catch (error) {
    // No stock is better than wrong stock: the list then shows none.
    console.error('Product list stock:', error);
    return null;
  }
}

export default async function ProductsPage() {
  await requireRouteAccess('/dashboard/inventory');
  const [products, stock, canSeeCost, canSeeSellPrice, canEditCost, canManage, canManageFinance] = await Promise.all([
    getProducts(),
    stockByProduct(),
    hasPermission('cost.view'),
    hasPermission('sales.view'),
    hasPermission('cost.edit'),
    hasPermission('stock.manage'),
    hasPermission('finance.manage'),
  ]);
  // A gift takes stock and books an expense: giftProduct needs both.
  const canGift = canManage && canManageFinance;

  return (
    <ProductTable
      products={products}
      stock={stock}
      canSeeCost={canSeeCost}
      canSeeSellPrice={canSeeSellPrice}
      canEditCost={canEditCost}
      canManage={canManage}
      canGift={canGift}
    />
  );
}
