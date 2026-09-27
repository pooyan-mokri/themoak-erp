'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/dashboard/section-card';
import { generateProductBarcodeAction } from '@/actions/product';
import { barcodeFormatFor, isStandardBarcode } from '@/lib/barcode-format';
import { BarcodeDisplay } from './barcode-display';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Barcode, Download, Printer, RefreshCw } from 'lucide-react';

interface ProductBarcodeProps {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode?: string;
  };
  /** May issue a barcode (stock.manage); printing and the SVG are for everyone. */
  canManage?: boolean;
}

export function ProductBarcode({ product, canManage = false }: ProductBarcodeProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const barcodeRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async (replace: boolean) => {
    if (replace) {
      if (!confirm('با ساخت بارکد جدید، برچسب‌های چاپ‌شدهٔ قبلی این کالا دیگر خوانده نمی‌شوند. ادامه می‌دهید؟')) {
        return;
      }
    }

    setIsGenerating(true);
    try {
      const result = await generateProductBarcodeAction(product.id, replace);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error('خطا در تولید بارکد.');
    } finally {
      setIsGenerating(false);
    }
  };

  // The label page picks the print size.
  const handlePrint = () => {
    window.open(`/dashboard/inventory/products/${product.id}/barcode`, '_blank');
  };

  const handleDownload = () => {
    if (!product.barcode) return;

    // Create SVG barcode
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
        <text x="150" y="75" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold">
          ${product.barcode}
        </text>
        <text x="150" y="100" text-anchor="middle" font-family="Arial" font-size="14">
          ${product.name}
        </text>
      </svg>
    `;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barcode-${product.sku}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <SectionCard
      title="بارکد"
      aside={
        !product.barcode &&
        canManage && (
          <Button onClick={() => handleGenerate(false)} disabled={isGenerating} size="sm">
            <Barcode className="h-4 w-4" />
            {isGenerating ? 'در حال تولید...' : 'تولید بارکد'}
          </Button>
        )
      }
    >
      {product.barcode ? (
        <div className="space-y-3">
          <div ref={barcodeRef} className="flex flex-col items-center rounded-md border bg-white px-4 py-3">
            <p className="max-w-full truncate text-[12px] text-muted-foreground">
              <bdi>{product.name}</bdi> · <span className="font-mono" dir="ltr">{product.sku}</span>
            </p>
            <div className="my-2 w-52 max-w-full">
              <BarcodeDisplay barcode={product.barcode} format={barcodeFormatFor(product.barcode)} />
            </div>
            <p className="font-mono text-[15px] tracking-[.2em]" dir="ltr">
              {product.barcode}
            </p>
          </div>
          {!isStandardBarcode(product.barcode) && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
              این بارکد استاندارد نیست؛ برای خوانده شدن بهتر، «تولید مجدد» را بزنید.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handlePrint} variant="outline" size="sm" title="اندازهٔ برچسب را در صفحهٔ چاپ انتخاب کنید">
              <Printer className="h-4 w-4" />
              چاپ برچسب
            </Button>
            <Button onClick={handleDownload} variant="outline" size="sm">
              <Download className="h-4 w-4" />
              دانلود SVG
            </Button>
            {canManage && (
              <Button onClick={() => handleGenerate(true)} variant="outline" size="sm" disabled={isGenerating}>
                <RefreshCw className="h-4 w-4" />
                {isGenerating ? 'در حال تولید...' : 'تولید مجدد'}
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground">بارکد یکتا؛ در همهٔ بخش‌های سیستم خوانده می‌شود.</p>
        </div>
      ) : (
        <div className="py-6 text-center text-[13px] text-muted-foreground">
          <p>این کالا هنوز بارکد ندارد.</p>
          <p className="mt-1 text-[12px]">
            {canManage
              ? 'برای ساخت بارکد یکتا «تولید بارکد» را بزنید.'
              : 'ساخت بارکد با نقش‌هایی است که اجازهٔ مدیریت کالا دارند.'}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
