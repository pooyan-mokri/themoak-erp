import { getSuppliers } from '@/actions/supplier';
import { getInventoryByProduct } from '@/actions/inventory'; // We need a way to get products
import { OrderForm } from '@/components/suppliers/order-form';
import { prisma } from '@/lib/prisma';

export default async function NewOrderPage() {
  const { data: suppliers } = await getSuppliers();
  const products = await prisma.product.findMany();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">سفارش خرید جدید</h1>
      <OrderForm 
        suppliers={suppliers || []} 
        products={products.map((p: any) => ({ id: p.id, name: p.name }))} 
      />
    </div>
  );
}
