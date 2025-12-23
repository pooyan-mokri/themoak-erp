'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash } from 'lucide-react';
import { GiftProductDialog } from './gift-product-dialog';
import { ProductForm } from './product-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from 'react';
import { deleteProduct } from '@/actions/product';
import { toast } from 'sonner';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import Link from 'next/link';

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  productType?: string;
  costPrice: any; // Decimal
  sellPrice: any; // Decimal
  wooId?: number | null;
}

interface ProductTableProps {
  products: Product[];
}

const getProductTypeLabel = (type?: string) => {
  const types: Record<string, string> = {
    SALEABLE: 'محصول فروختنی',
    FIXED_ASSET: 'دارایی ثابت',
    CONSUMABLE: 'کالای مصرفی',
    OTHER: 'سایر',
  };
  return types[type || 'SALEABLE'] || 'نامشخص';
};

const getProductTypeBadge = (type?: string) => {
  const badges: Record<string, string> = {
    SALEABLE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    FIXED_ASSET: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    CONSUMABLE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    OTHER: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  };
  return badges[type || 'SALEABLE'] || badges.OTHER;
};

export function ProductTable({ products }: ProductTableProps) {
  const columns: DataTableColumn<Product>[] = [
    {
      key: 'name',
      label: 'نام کالا',
      sortable: true,
      render: (product) => (
        <Link 
          href={`/dashboard/inventory/products/${product.id}`}
          className="font-medium text-primary hover:underline"
        >
          {product.name}
        </Link>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      sortable: true,
      render: (product) => product.sku,
    },
    {
      key: 'barcode',
      label: 'بارکد',
      sortable: true,
      render: (product) => (
        product.barcode ? (
          <span className="font-mono text-sm">{product.barcode}</span>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
    },
    {
      key: 'productType',
      label: 'نوع کالا',
      sortable: true,
      render: (product) => (
        <Badge variant="outline" className={getProductTypeBadge(product.productType)}>
          {getProductTypeLabel(product.productType)}
        </Badge>
      ),
    },
    {
      key: 'costPrice',
      label: 'قیمت خرید',
      sortable: true,
      render: (product) => `${Number(product.costPrice).toLocaleString('fa-IR')} تومان`,
    },
    {
      key: 'sellPrice',
      label: 'قیمت فروش',
      sortable: true,
      render: (product) => `${Number(product.sellPrice).toLocaleString('fa-IR')} تومان`,
    },
    {
      key: 'wooId',
      label: 'وضعیت سینک',
      sortable: true,
      render: (product) =>
        product.wooId ? (
          <span className="text-green-600 text-xs bg-green-100 px-2 py-1 rounded-full">متصل</span>
        ) : (
          <span className="text-gray-500 text-xs bg-gray-100 px-2 py-1 rounded-full">داخلی</span>
        ),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-right',
      render: (product) => <ProductActions product={product} />,
    },
  ];

  return (
    <DataTable
      data={products}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در کالاها (نام، SKU)..."
      searchKeys={['name', 'sku']}
      filterable={true}
      filters={[
        {
          key: 'productType',
          label: 'نوع کالا',
          options: [
            { value: 'SALEABLE', label: 'محصول فروختنی' },
            { value: 'FIXED_ASSET', label: 'دارایی ثابت' },
            { value: 'CONSUMABLE', label: 'کالای مصرفی' },
            { value: 'OTHER', label: 'سایر' },
          ],
        },
      ]}
      defaultSort={{ key: 'name', direction: 'asc' }}
      pageSize={15}
      emptyMessage="هیچ کالایی یافت نشد."
    />
  );
}

function ProductActions({ product }: { product: Product }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteProduct(product.id);
    setIsDeleting(false);
    
    if (result.success) {
      toast.success(result.message);
      setIsDeleteOpen(false);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <GiftProductDialog productId={product.id} productName={product.name} />
      
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Edit className="h-4 w-4 text-blue-500" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ویرایش محصول</DialogTitle>
          </DialogHeader>
          <ProductForm 
            initialData={product} 
            onSuccess={() => setIsEditOpen(false)} 
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Trash className="h-4 w-4 text-red-500" />
          </Button>
        </AlertDialogTrigger>
          <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>آیا از حذف این کالا اطمینان دارید؟</AlertDialogTitle>
            <AlertDialogDescription>
              این عملیات قابل بازگشت نیست. در صورت وجود موجودی یا سفارش، امکان حذف وجود ندارد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={(e: React.MouseEvent) => { e.preventDefault(); handleDelete(); }} disabled={isDeleting}>
              {isDeleting ? 'در حال حذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
