import { getSuppliers } from '@/actions/supplier';
import { getInventoryByProduct } from '@/actions/inventory'; // We need a way to get products
import { OrderForm } from '@/components/suppliers/order-form';
import { prisma } from '@/lib/prisma';
import { requireRouteAccess } from '@/lib/access';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewOrderPage() {
  await requireRouteAccess('/dashboard/suppliers');
  const { data: suppliers } = await getSuppliers();
  const products = await prisma.product.findMany();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="سفارش خرید جدید" description="اقلام با ارز هر ردیف و هزینه‌های اضافی؛ مبلغ به تومان با نرخ روز حساب می‌شود" />
      <OrderForm 
        suppliers={suppliers || []} 
        products={products.map((p: any) => ({ id: p.id, name: p.name }))} 
      />
    </div>
  );
}
