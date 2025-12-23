import { getStockTurnoverReport, getInventoryAgingReport } from '@/actions/reports';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default async function InventoryReportsPage() {
  const [stockTurnover, inventoryAging] = await Promise.all([
    getStockTurnoverReport(),
    getInventoryAgingReport(),
  ]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(value)) + ' تومان';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارشات موجودی</h1>
        <p className="text-muted-foreground">
          تحلیل گردش و قدمت موجودی کالا
        </p>
      </div>

      {/* Stock Turnover */}
      <Card>
        <CardHeader>
          <CardTitle>نرخ گردش موجودی</CardTitle>
          <CardDescription>
            نسبت فروش به موجودی در 90 روز گذشته
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>محصول</TableHead>
                <TableHead className="text-right">موجودی فعلی</TableHead>
                <TableHead className="text-right">فروش (90 روز)</TableHead>
                <TableHead className="text-right">نرخ گردش</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockTurnover.slice(0, 20).map((product, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-right">{product.currentStock}</TableCell>
                  <TableCell className="text-right">{product.soldQuantity}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={product.turnoverRate > 1 ? 'default' : 'secondary'}>
                      {product.turnoverRate.toFixed(2)}x
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Inventory Aging */}
      <Card>
        <CardHeader>
          <CardTitle>قدمت موجودی</CardTitle>
          <CardDescription>
            کالاهایی که مدت زیادی در انبار مانده‌اند
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>محصول</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">تعداد</TableHead>
                <TableHead className="text-right">ارزش</TableHead>
                <TableHead className="text-right">روز در انبار</TableHead>
                <TableHead>دسته‌بندی</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryAging.filter(item => item.daysInStock > 90).map((product, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.sku}</TableCell>
                  <TableCell className="text-right">{product.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(product.value)}</TableCell>
                  <TableCell className="text-right">{product.daysInStock}</TableCell>
                  <TableCell>
                    <Badge 
                      variant={product.daysInStock > 180 ? 'destructive' : 'secondary'}
                    >
                      {product.category}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
