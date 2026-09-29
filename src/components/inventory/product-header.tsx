'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Edit, ExternalLink, Image as ImageIcon, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { ProductForm } from './product-form';
import { STOCK_STATUS, productTypeLabel, stockStatus } from './stock-status';
import { isLocalProductImage } from '@/lib/product-image';

interface ProductHeaderProps {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode?: string;
    productType?: string;
    webId?: string;
    image?: string;
    imageUrl?: string;
    siteUrl?: string;
    costPrice?: number;
    sellPrice?: number;
    totalStock: number;
    createdAt: Date;
    updatedAt: Date;
  };
  showBackButton?: boolean;
  /** «فروش سریع»: may sell (sales.manage). */
  canSell?: boolean;
  /** «ویرایش»: may change products (stock.manage). */
  canManage?: boolean;
  canEditCost?: boolean;
  canSeeSellPrice?: boolean;
}

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]';

export function ProductHeader({
  product,
  showBackButton = false,
  canSell = false,
  canManage = false,
  canEditCost = false,
  canSeeSellPrice = false,
}: ProductHeaderProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const status = STOCK_STATUS[stockStatus(product.totalStock)];

  return (
    <div className="space-y-3">
      {showBackButton && (
        <Link
          href="/dashboard/inventory/products"
          className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          بازگشت به فهرست کالاها
        </Link>
      )}
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-start">
        {/* Product Image */}
        <div className="shrink-0">
          {product.imageUrl ? (
            // The website's photo: a plain <img>, so a change of image host on
            // the site can never break this page the way next/image would.
            <div className="relative h-24 w-24 overflow-hidden rounded-md border bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover object-[50%_60%]" />
            </div>
          ) : product.image ? (
            <div className="relative h-24 w-24 overflow-hidden rounded-md border bg-secondary">
              {isLocalProductImage(product.image) ? (
                // A plain <img> for a photo on this ERP: it carries the session, which next/image's fetch would not
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                // Use Next.js Image for external URLs
                <Image src={product.image} alt={product.name} fill className="object-cover" />
              )}
            </div>
          ) : (
            <div className="grid h-24 w-24 place-items-center rounded-md border bg-secondary text-muted-foreground">
              <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="min-w-0 flex-1 space-y-3">
          <PageHeader
            title={product.name}
            description={
              <>
                ایجاد <span className="tabular-nums">{formatJalaliDate(product.createdAt)}</span>
                {' · '}
                آخرین تغییر <span className="tabular-nums">{formatJalaliDate(product.updatedAt)}</span>
              </>
            }
            actions={
              <>
                {product.siteUrl && (
                  <Button variant="outline" asChild>
                    <a href={product.siteUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      مشاهده در سایت
                    </a>
                  </Button>
                )}
                {canManage && (
                  <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Edit className="h-4 w-4" />
                        ویرایش
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>ویرایش محصول</DialogTitle>
                      </DialogHeader>
                      <ProductForm
                        initialData={product}
                        onSuccess={() => {
                          setIsEditOpen(false);
                          router.refresh();
                        }}
                        canEditCost={canEditCost}
                        canSeeSellPrice={canSeeSellPrice}
                      />
                    </DialogContent>
                  </Dialog>
                )}
                {canSell && (
                  <Button asChild>
                    <Link href={`/dashboard/sales/pos?product=${encodeURIComponent(product.id)}`}>
                      <ShoppingCart className="h-4 w-4" />
                      فروش سریع
                    </Link>
                  </Button>
                )}
              </>
            }
          />
          <div className="flex flex-wrap gap-1.5">
            <span className={cn(pill, status.tone)}>{status.label}</span>
            <span className={cn(pill, 'bg-secondary text-muted-foreground')}>{productTypeLabel(product.productType)}</span>
            <span className={cn(pill, 'border text-muted-foreground')}>
              SKU
              <span className="font-mono text-foreground" dir="ltr">
                {product.sku}
              </span>
            </span>
            {product.barcode && (
              <span className={cn(pill, 'border text-muted-foreground')}>
                بارکد
                <span className="font-mono text-foreground" dir="ltr">
                  {product.barcode}
                </span>
              </span>
            )}
            {product.webId && (
              <span className={cn(pill, 'border text-muted-foreground')}>
                شناسهٔ سایت
                <span className="font-mono text-foreground" dir="ltr">
                  {product.webId}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
