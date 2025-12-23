import { getProducts } from '@/actions/product';
import { ProductTable } from '@/components/inventory/product-table';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

import { ProductActions } from '@/components/inventory/product-actions';

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">تعریف کالا</h1>
        <div className="flex gap-2">
          <ProductActions products={products} />
          <Link href="/dashboard/inventory/products/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> افزودن کالا
            </Button>
          </Link>
        </div>
      </div>
      <ProductTable products={products} />
    </div>
  );
}
