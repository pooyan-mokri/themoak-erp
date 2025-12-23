'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Package } from 'lucide-react';
import Link from 'next/link';

interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  totalStock: number;
  warehouses: Array<{
    name: string;
    quantity: number;
  }>;
}

interface LowStockAlertProps {
  items: LowStockItem[];
}

export function LowStockAlert({ items }: LowStockAlertProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            موجودی پایین
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            همه محصولات موجودی کافی دارند ✓
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-600" />
          هشدار موجودی پایین ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/inventory/products/${item.id}`}
              className="block"
            >
              <Alert className="border-l-4 border-l-orange-500 hover:bg-accent cursor-pointer">
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-2xl font-bold text-orange-600">{item.totalStock}</p>
                      <p className="text-xs text-muted-foreground">واحد باقی‌مانده</p>
                    </div>
                  </div>
                  {item.warehouses.length > 0 && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">توزیع انبار:</p>
                      <div className="flex flex-wrap gap-2">
                        {item.warehouses.map((wh, index) => (
                          <span
                            key={index}
                            className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded"
                          >
                            {wh.name}: {wh.quantity}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
