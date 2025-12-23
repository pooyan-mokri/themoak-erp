import { getWarehouseDetail } from '@/actions/warehouse-detail';
import { WarehouseDetailView } from '@/components/inventory/warehouse-detail-view';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Package, DollarSign, TrendingUp, AlertTriangle, Boxes, Warehouse as WarehouseIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function WarehouseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  console.log('WarehouseDetailPage called with params:', params);
  
  try {
    const data = await getWarehouseDetail(params.id);
    console.log('Warehouse detail data received:', data ? 'data exists' : 'data is null');

    if (!data) {
      console.error('Warehouse detail returned null for ID:', params.id);
      notFound();
    }

    const { warehouse, statistics, inventory, recentOrderItems, recentPurchaseItems, recentAudits, lowStockItems, topProductsByValue } = data;

    return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/dashboard/inventory/warehouses">
              <Button variant="ghost" size="sm">
                <ArrowRight className="h-4 w-4 ml-2 rotate-180" />
                بازگشت به لیست انبارها
              </Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{warehouse.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            {warehouse.isVirtual ? (
              <Badge variant="secondary" className="text-sm">
                <WarehouseIcon className="h-3 w-3 ml-1" />
                انبار مجازی (امانی)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-sm">
                <WarehouseIcon className="h-3 w-3 ml-1" />
                انبار فیزیکی
              </Badge>
            )}
            {warehouse.customer && (
              <Badge variant="outline" className="text-sm">
                مشتری: {warehouse.customer.name}
              </Badge>
            )}
          </div>
        </div>
        <div className="text-left text-sm text-muted-foreground">
          <p>تاریخ ایجاد: {warehouse.createdAt}</p>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل موجودی</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalItems.toLocaleString('fa-IR')}</div>
            <p className="text-xs text-muted-foreground">
              {statistics.uniqueProducts} محصول مختلف
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ارزش کل موجودی</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.totalValue.toLocaleString('fa-IR')} تومان
            </div>
            <p className="text-xs text-muted-foreground">بر اساس قیمت تمام شده</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">محصولات موجود</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.itemsWithStock.toLocaleString('fa-IR')}</div>
            <p className="text-xs text-muted-foreground">
              از {statistics.uniqueProducts} محصول
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">موجودی کم</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {statistics.lowStockCount.toLocaleString('fa-IR')}
            </div>
            <p className="text-xs text-muted-foreground">نیاز به بررسی</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Inventory List */}
        <div className="lg:col-span-2 space-y-6">
          <WarehouseDetailView
            inventory={inventory}
            recentOrderItems={recentOrderItems}
            recentPurchaseItems={recentPurchaseItems}
            recentAudits={recentAudits}
            lowStockItems={lowStockItems}
            topProductsByValue={topProductsByValue}
          />
        </div>

        {/* Right Column - Summary and Actions */}
        <div className="space-y-6">
          {/* Low Stock Alert */}
          {lowStockItems.length > 0 && (
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-orange-900 dark:text-orange-100 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  هشدار موجودی کم
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {lowStockItems.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center text-sm p-2 bg-white dark:bg-gray-900 rounded"
                    >
                      <span className="font-medium">{item.productName}</span>
                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                        {item.quantity} عدد
                      </Badge>
                    </div>
                  ))}
                  {lowStockItems.length > 5 && (
                    <p className="text-xs text-orange-600 mt-2">
                      و {lowStockItems.length - 5} مورد دیگر...
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Products by Value */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                پرارزش‌ترین محصولات
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topProductsByValue.slice(0, 5).map((item, index) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6">#{index + 1}</span>
                      <span className="font-medium">{item.productName}</span>
                    </div>
                    <div className="text-left">
                      <div className="font-bold">{item.totalValue.toLocaleString('fa-IR')}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.quantity} × {item.costPrice.toLocaleString('fa-IR')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">عملیات سریع</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`/dashboard/inventory/console/${warehouse.id}`}>
                <Button variant="outline" className="w-full justify-start">
                  <Package className="h-4 w-4 ml-2" />
                  کنسول انبار
                </Button>
              </Link>
              <Link href={`/dashboard/inventory/audits?warehouse=${warehouse.id}`}>
                <Button variant="outline" className="w-full justify-start">
                  <AlertTriangle className="h-4 w-4 ml-2" />
                  انبارگردانی
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    );
  } catch (error: any) {
    console.error('Error loading warehouse detail:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error message:', error?.message);
    console.error('Params:', params);
    notFound();
  }
}

