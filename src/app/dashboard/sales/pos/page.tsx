import { getProducts } from '@/actions/product';
import { getCustomers } from '@/actions/customer';
import { getAccounts } from '@/actions/accounting';
import { getWarehouses } from '@/actions/warehouse';
import { POSInterface } from '@/components/sales/pos-interface';

export default async function POSPage() {
  const [products, customers, allAccounts, warehouses] = await Promise.all([
    getProducts(),
    getCustomers(),
    getAccounts(),
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
