'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/ui/back-button';
import { Package2, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { formatJalaliDate } from '@/lib/date-utils';

interface ProductHeaderProps {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode?: string;
    image?: string;
    createdAt: Date;
    updatedAt: Date;
  };
  showBackButton?: boolean;
}

export function ProductHeader({ product, showBackButton = false }: ProductHeaderProps) {
  return (
    <Card className="p-6">
      {showBackButton && (
        <div className="mb-4">
          <BackButton href="/dashboard/inventory/products" label="بازگشت به لیست محصولات" />
        </div>
      )}
      <div className="flex gap-6">
        {/* Product Image */}
        <div className="flex-shrink-0">
          {product.image ? (
            <div className="relative w-32 h-32 rounded-lg overflow-hidden border bg-gray-100">
              {product.image.startsWith('/uploads/') ? (
                // Use regular img tag for local uploads
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                // Use Next.js Image for external URLs
                <Image
                  src={product.image}
                  alt={product.name}
                  fill
                  className="object-cover"
                />
              )}
            </div>
          ) : (
            <div className="w-32 h-32 rounded-lg border flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <ImageIcon className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{product.name}</h1>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant="outline" className="font-mono">
                  SKU: {product.sku}
                </Badge>
                {product.barcode && (
                  <Badge variant="outline" className="font-mono">
                    بارکد: {product.barcode}
                  </Badge>
                )}
                <Badge variant="secondary">
                  <Package2 className="h-3 w-3 ml-1" />
                  محصول فعال
                </Badge>
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-6 text-sm text-muted-foreground">
            <div>
              <span className="font-medium">تاریخ ایجاد:</span>{' '}
              {formatJalaliDate(product.createdAt)}
            </div>
            <div>
              <span className="font-medium">آخرین بروزرسانی:</span>{' '}
              {formatJalaliDate(product.updatedAt)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
