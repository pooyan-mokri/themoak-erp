import { getProducts } from '@/actions/product';
import { getCustomers } from '@/actions/customer';
import { getAccountOptions } from '@/actions/account-options';
import { getWarehouses } from '@/actions/warehouse';
import { POSInterface } from '@/components/sales/pos-interface';
import { requireRouteAccess } from '@/lib/access';

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

  return (
    <div className="h-full">
      <POSInterface 
        products={products} 
        customers={customers} 
        accounts={accounts}
        warehouses={physicalWarehouses}
      />
    </div>
  );
}
