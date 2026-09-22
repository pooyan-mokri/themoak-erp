import { getProducts } from '@/actions/product';
import { getCustomers } from '@/actions/customer';
import { getAccountOptions } from '@/actions/account-options';
import { getWarehouses } from '@/actions/warehouse';
import { POSInterface } from '@/components/sales/pos-interface';
import { requireRouteAccess } from '@/lib/access';
import { DEFAULT_SITE_WAREHOUSE_NAME, pickWithDefault } from '@/lib/site-connection';

export default async function POSPage() {
  await requireRouteAccess('/dashboard/sales');
  const [products, customers, allAccounts, warehouses] = await Promise.all([
    getProducts(),
    getCustomers(),
    getAccountOptions(),
    getWarehouses(),
  ]);
  
  // Filter accounts to only show Bank and Cash
  const accounts = allAccounts.filter((a: any) => a.type === 'BANK' || a.type === 'CASH');

  // Filter to only physical (non-virtual) warehouses for POS sales
  const physicalWarehouses = warehouses.filter((w: any) => !w.isVirtual);
  // The shop sells from مشاهیر: start there, not in whichever warehouse was created first
  // (a sale left on the wrong default drove an unused warehouse deep into negative stock).
  const defaultWarehouseId =
    pickWithDefault(physicalWarehouses, null, DEFAULT_SITE_WAREHOUSE_NAME) ?? physicalWarehouses[0]?.id ?? '';

  return (
    <div className="h-full">
      <POSInterface 
        products={products} 
        customers={customers} 
        accounts={accounts}
        warehouses={physicalWarehouses}
        defaultWarehouseId={defaultWarehouseId}
      />
    </div>
  );
}
