import { getWarehouseDashboardStats } from '@/actions/inventory';
import { getWarehouses } from '@/actions/warehouse';
import { getProducts } from '@/actions/product';
import { WarehouseStats } from '@/components/inventory/warehouse-stats';
import { TransferForm } from '@/components/inventory/transfer-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeftRight } from 'lucide-react';

export default async function WarehouseConsolePage() {
  const [stats, warehouses, products] = await Promise.all([
    getWarehouseDashboardStats(),
    getWarehouses(),
    getProducts(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">کنسول انبار</h2>
        <p className="text-muted-foreground">مدیریت موجودی، انتقالات و گزارشات انبار</p>
      </div>

      <WarehouseStats stats={stats} />

      <div className="grid gap-6 md:grid-cols-2">
        <TransferForm warehouses={warehouses} products={products} />
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              راهنمای عملیات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">انتقال موجودی</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                برای جابجایی کالا بین انبارها، از فرم مقابل استفاده کنید. موجودی انبار مبدا کسر و به انبار مقصد اضافه می‌شود.
              </p>
            </div>
            
            <div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-100 dark:border-yellow-900">
              <h4 className="font-medium text-yellow-900 dark:text-yellow-100 mb-2">هشدار موجودی</h4>
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                سیستم به صورت خودکار اجازه انتقال بیش از موجودی فعلی انبار مبدا را نمی‌دهد.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
