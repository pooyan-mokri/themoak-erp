import { getProducts } from '@/actions/product';
import { getCustomers } from '@/actions/customer';
import { getAccounts } from '@/actions/accounting';
import { POSInterface } from '@/components/sales/pos-interface';

export default async function POSPage() {
  const products = await getProducts();
  const customers = await getCustomers();
  const allAccounts = await getAccounts();
  
  // Filter accounts to only show Bank and Cash
  const accounts = allAccounts.filter(a => a.type === 'BANK' || a.type === 'CASH');

  return (
    <div className="h-full">
      <POSInterface 
        products={products} 
        customers={customers} 
        accounts={accounts} 
      />
    </div>
  );
}
