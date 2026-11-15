import { getProducts } from '@/actions/product';
import { getCustomers } from '@/actions/customer';
import { getAccountOptions } from '@/actions/account-options';
import { getWarehouses } from '@/actions/warehouse';
import { getInventoryByWarehouse } from '@/actions/inventory';
import { POSInterface } from '@/components/sales/pos-interface';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { DEFAULT_SITE_WAREHOUSE_NAME, pickWithDefault } from '@/lib/site-connection';

/** Quantity by warehouse, then product, for the cards and the cart (read with the inventory action). */
async function stockByWarehouse(warehouseIds: string[]): Promise<Record<string, Record<string, number>> | null> {
  try {
    const rows = await Promise.all(warehouseIds.map((id) => getInventoryByWarehouse(id)));
    return Object.fromEntries(
      warehouseIds.map((id, index) => [
        id,
        Object.fromEntries(rows[index].map((row: { productId: string; quantity: number }) => [row.productId, row.quantity])),
      ]),
    );
  } catch (error) {
    // No stock is better than wrong stock: the cards then show none.
    console.error('POS stock:', error);
    return null;
  }
}

export default async function POSPage({ searchParams: searchParamsPromise }: { searchParams?: Promise<{ product?: string }> }) {
  await requireRouteAccess('/dashboard/sales');
  const searchParams = (await searchParamsPromise) ?? {};
  const [products, customers, allAccounts, warehouses, canSell, canSeeStock] = await Promise.all([
    getProducts(),
    getCustomers(),
    getAccountOptions(),
    getWarehouses(),
    hasPermission('sales.manage'),
    hasPermission('stock.view'),
  ]);

  // Filter accounts to only show Bank and Cash
  const accounts = allAccounts.filter((a: any) => a.type === 'BANK' || a.type === 'CASH');

  // Filter to only physical (non-virtual) warehouses for POS sales
  const physicalWarehouses = warehouses.filter((w: any) => !w.isVirtual);
  // The shop sells from مشاهیر: start there, not in whichever warehouse was created first
  // (a sale left on the wrong default drove an unused warehouse deep into negative stock).
  const defaultWarehouseId =
    pickWithDefault(physicalWarehouses, null, DEFAULT_SITE_WAREHOUSE_NAME) ?? physicalWarehouses[0]?.id ?? '';

  // Quantities are stock.view; a role without it sells without them.
  const stock = canSeeStock ? await stockByWarehouse(physicalWarehouses.map((w: any) => w.id)) : null;

  return (
    <POSInterface
      products={products}
      customers={customers}
      accounts={accounts}
      warehouses={physicalWarehouses}
      defaultWarehouseId={defaultWarehouseId}
      stock={stock}
      canSell={canSell}
      initialProductId={typeof searchParams?.product === 'string' ? searchParams.product : undefined}
    />
  );
}
