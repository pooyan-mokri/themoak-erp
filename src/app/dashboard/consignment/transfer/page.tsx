import { getWarehouses } from '@/actions/warehouse';
import { getProducts } from '@/actions/product';
import { TransferForm } from '@/components/consignment/transfer-form';

export default async function TransferPage() {
  const warehouses = await getWarehouses();
  const products = await getProducts();

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">انتقال موجودی به همکار</h1>
      <TransferForm warehouses={warehouses} products={products} />
    </div>
  );
}
