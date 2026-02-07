'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Package, TrendingUp, Warehouse } from 'lucide-react';

interface InventoryReportProps {
  report: {
    summary: {
      totalValue: number;
      totalQuantity: number;
      totalUniqueProducts: number;
      totalWarehouses: number;
      lowStockCount: number;
      outOfStockCount: number;
    };
    lowStockItems: Array<{
      productId: string;
      productName: string;
      sku: string;
      warehouseName: string;
      quantity: number;
      costPrice: number;
      sellPrice: number;
      value: number;
    }>;
    outOfStockItems: Array<{
      productId: string;
      productName: string;
      sku: string;
      warehouseName: string;
      costPrice: number;
      sellPrice: number;
    }>;
    topProductsByQuantity: Array<{
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      costPrice: number;
      sellPrice: number;
      value: number;
    }>;
    topProductsByValue: Array<{
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      costPrice: number;
      sellPrice: number;
      value: number;
    }>;
    warehouseDistribution: Array<{
      warehouseName: string;
      quantity: number;
      value: number;
    }>;
  };
}

export function InventoryReport({ report }: InventoryReportProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ارزش کل موجودی</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(report.summary.totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              بر اساس قیمت خرید
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد کل موجودی</CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(report.summary.totalQuantity)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              واحد محصول قابل فروش
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کمبود موجودی</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(report.summary.lowStockCount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              محصول با موجودی کمتر از ۱۰ عدد
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">بدون موجودی</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(report.summary.outOfStockCount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              محصول بدون موجودی
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Warehouse Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            توزیع موجودی بین انبارها
          </CardTitle>
          <CardDescription>
            توزیع موجودی و ارزش کالاها در هر انبار
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">انبار</TableHead>
                <TableHead className="text-right">تعداد کل</TableHead>
                <TableHead className="text-right">ارزش کل (تومان)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.warehouseDistribution.length > 0 ? (
                report.warehouseDistribution.map((warehouse, index) => (
                  <TableRow key={warehouse.warehouseName} className="animate-fade-in-up" style={{ animationDelay: `${0.1 * index}s` }}>
                    <TableCell className="font-medium">{warehouse.warehouseName}</TableCell>
                    <TableCell>{formatNumber(warehouse.quantity)}</TableCell>
                    <TableCell>{formatCurrency(warehouse.value)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    داده‌ای یافت نشد
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Low Stock Items */}
      {report.lowStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
              محصولات با موجودی کم
            </CardTitle>
            <CardDescription>
              محصولاتی که موجودی آن‌ها کمتر از ۱۰ عدد است
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right">SKU</TableHead>
                  <TableHead className="text-right">انبار</TableHead>
                  <TableHead className="text-right">موجودی</TableHead>
                  <TableHead className="text-right">قیمت خرید</TableHead>
                  <TableHead className="text-right">ارزش</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lowStockItems.map((item, index) => (
                  <TableRow key={`${item.productId}-${item.warehouseName}`} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * index}s` }}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>{item.warehouseName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                        {formatNumber(item.quantity)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(item.costPrice)}</TableCell>
                    <TableCell>{formatCurrency(item.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Out of Stock Items */}
      {report.outOfStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              محصولات بدون موجودی
            </CardTitle>
            <CardDescription>
              محصولاتی که در انبار موجودی ندارند
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right">SKU</TableHead>
                  <TableHead className="text-right">انبار</TableHead>
                  <TableHead className="text-right">قیمت خرید</TableHead>
                  <TableHead className="text-right">قیمت فروش</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.outOfStockItems.map((item, index) => (
                  <TableRow key={`${item.productId}-${item.warehouseName}`} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * index}s` }}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>{item.warehouseName}</TableCell>
                    <TableCell>{formatCurrency(item.costPrice)}</TableCell>
                    <TableCell>{formatCurrency(item.sellPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Top Products by Quantity */}
      {report.topProductsByQuantity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              محصولات با بیشترین موجودی (تعداد)
            </CardTitle>
            <CardDescription>
              ۱۰ محصول با بیشترین تعداد موجودی
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رتبه</TableHead>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right">SKU</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">ارزش کل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topProductsByQuantity.map((item, index) => (
                  <TableRow key={item.productId} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * index}s` }}>
                    <TableCell>
                      <Badge variant="outline">{index + 1}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>{formatNumber(item.quantity)}</TableCell>
                    <TableCell>{formatCurrency(item.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Top Products by Value */}
      {report.topProductsByValue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              محصولات با بیشترین ارزش موجودی
            </CardTitle>
            <CardDescription>
              ۱۰ محصول با بیشترین ارزش موجودی
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رتبه</TableHead>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right">SKU</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">ارزش کل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.topProductsByValue.map((item, index) => (
                  <TableRow key={item.productId} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * index}s` }}>
                    <TableCell>
                      <Badge variant="outline">{index + 1}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>{formatNumber(item.quantity)}</TableCell>
                    <TableCell className="font-bold text-green-600">{formatCurrency(item.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}




