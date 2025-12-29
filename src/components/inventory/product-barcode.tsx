'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { generateProductBarcodeAction } from '@/actions/product';
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
}

export function ProductBarcode({ product }: ProductBarcodeProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const barcodeRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    if (product.barcode) {
      if (!confirm('این محصول قبلاً بارکد دارد. آیا می‌خواهید بارکد جدید تولید کنید؟')) {
        return;
      }
    }

    setIsGenerating(true);
    try {
      const result = await generateProductBarcodeAction(product.id);
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Barcode className="h-5 w-5" />
              بارکد محصول
            </CardTitle>
            <CardDescription>
              بارکد یکتا برای این محصول
            </CardDescription>
          </div>
          {!product.barcode && (
            <Button onClick={handleGenerate} disabled={isGenerating} size="sm">
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  در حال تولید...
                </>
              ) : (
                <>
                  <Barcode className="h-4 w-4 mr-2" />
                  تولید بارکد
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {product.barcode ? (
          <div className="space-y-4">
            <div ref={barcodeRef} className="flex flex-col items-center p-6 border rounded-lg bg-white">
              <div className="text-center mb-2">
                <div className="font-semibold text-sm">{product.name}</div>
                <div className="text-xs text-muted-foreground mt-1">SKU: {product.sku}</div>
              </div>
              <div className="font-mono text-2xl font-bold tracking-wider text-center mb-4">
                {product.barcode}
              </div>
              <div className="text-xs text-center text-muted-foreground">
                بارکد یکتا
              </div>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={handlePrint} variant="outline">
                <Printer className="h-4 w-4 mr-2" />
                چاپ
              </Button>
              <Button onClick={handleDownload} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                دانلود SVG
              </Button>
              <Button onClick={handleGenerate} variant="outline" disabled={isGenerating}>
                <RefreshCw className="h-4 w-4 mr-2" />
                تولید مجدد
              </Button>
            </div>
            <Badge variant="secondary" className="w-full justify-center">
              این بارکد در تمام سیستم قابل استفاده است
            </Badge>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Barcode className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>این محصول هنوز بارکد ندارد.</p>
            <p className="text-sm mt-2">برای تولید بارکد یکتا، روی دکمه "تولید بارکد" کلیک کنید.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

