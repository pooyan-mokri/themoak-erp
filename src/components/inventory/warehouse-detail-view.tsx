'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Package, ShoppingCart, ShoppingBag, ClipboardCheck, FileSpreadsheet, FileText } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';

interface InventoryItem {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  totalValue: number;
  productType: string;
}

interface OrderItem {
  id: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
  orderNumber: number;
  customerName: string;
  orderDate: string;
}

interface PurchaseItem {
  id: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
  orderNumber: number;
  supplierName: string;
  orderDate: string;
}

interface Audit {
  id: string;
  status: string;
  createdBy: string;
  createdAt: string;
}

interface Movement {
  id: string;
  type: 'SALE' | 'PURCHASE' | 'RETURN' | 'ADJUSTMENT' | 'TRANSFER';
  productName: string;
  quantity: number;
  date: string;
  reference: string;
  counterpart: string;
  note?: string;
}

interface WarehouseDetailViewProps {
  warehouseName?: string;
  inventory: InventoryItem[];
  recentOrderItems: OrderItem[];
  recentPurchaseItems: PurchaseItem[];
  recentAudits: Audit[];
  movements: Movement[];
  lowStockItems: InventoryItem[];
  topProductsByValue: InventoryItem[];
}

function exportToExcel(inventory: InventoryItem[], warehouseName: string) {
  import('xlsx').then((XLSX) => {
    const rows = inventory.map((item) => ({
      'نام محصول': item.productName,
      'کد کالا (SKU)': item.sku,
      'نوع': item.productType === 'SALEABLE' ? 'قابل فروش' : item.productType === 'FIXED_ASSET' ? 'دارایی ثابت' : 'کالای مصرفی',
      'تعداد موجود': item.quantity,
      'قیمت تمام شده': item.costPrice,
      'ارزش کل': item.totalValue,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'موجودی');
    XLSX.writeFile(wb, `موجودی-${warehouseName}.xlsx`);
  });
}

function exportToPdf(inventory: InventoryItem[], warehouseName: string) {
  const rows = inventory
    .map(
      (item, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${item.productName}</td>
          <td>${item.sku}</td>
          <td>${item.quantity.toLocaleString('fa-IR')}</td>
          <td>${item.costPrice.toLocaleString('fa-IR')}</td>
          <td>${item.totalValue.toLocaleString('fa-IR')}</td>
        </tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/>
    <title>موجودی انبار ${warehouseName}</title>
    <style>body{font-family:Tahoma,sans-serif;font-size:12px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}
    th{background:#f0f0f0}h2{text-align:center}</style></head>
    <body><h2>موجودی انبار: ${warehouseName}</h2>
    <table><thead><tr><th>#</th><th>نام محصول</th><th>SKU</th><th>تعداد</th><th>قیمت تمام شده</th><th>ارزش کل</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    win.print();
  }
}

export function WarehouseDetailView({
  warehouseName = 'انبار',
  inventory,
  recentOrderItems,
  recentPurchaseItems,
  recentAudits,
  movements,
  lowStockItems,
  topProductsByValue,
}: WarehouseDetailViewProps) {
  return (
    <Tabs defaultValue="inventory" className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="inventory">
          <Package className="h-4 w-4 ml-2" />
          موجودی ({inventory.length})
        </TabsTrigger>
        <TabsTrigger value="movements">
          جابجایی‌ها
        </TabsTrigger>
        <TabsTrigger value="sales">
          <ShoppingCart className="h-4 w-4 ml-2" />
          فروش‌ها
        </TabsTrigger>
        <TabsTrigger value="purchases">
          <ShoppingBag className="h-4 w-4 ml-2" />
          خریدها
        </TabsTrigger>
        <TabsTrigger value="audits">
          <ClipboardCheck className="h-4 w-4 ml-2" />
          انبارگردانی‌ها
        </TabsTrigger>
      </TabsList>

      {/* Inventory Tab */}
      <TabsContent value="inventory" className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>لیست موجودی انبار</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportToExcel(inventory, warehouseName)}
                disabled={inventory.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4 ml-2" />
                خروجی اکسل
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportToPdf(inventory, warehouseName)}
                disabled={inventory.length === 0}
              >
                <FileText className="h-4 w-4 ml-2" />
                خروجی PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {inventory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                این انبار فاقد موجودی است
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">محصول</TableHead>
                      <TableHead className="text-right">کد کالا</TableHead>
                      <TableHead className="text-right">نوع</TableHead>
                      <TableHead className="text-right">تعداد</TableHead>
                      <TableHead className="text-right">قیمت تمام شده</TableHead>
                      <TableHead className="text-right">ارزش کل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/dashboard/inventory/products/${item.id}`}
                            className="hover:underline text-primary"
                          >
                            {item.productName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.sku}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.productType === 'SALEABLE' && 'قابل فروش'}
                            {item.productType === 'FIXED_ASSET' && 'دارایی ثابت'}
                            {item.productType === 'CONSUMABLE' && 'کالای مصرفی'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{item.quantity.toLocaleString('fa-IR')}</span>
                            {item.quantity === 0 && (
                              <Badge variant="destructive" className="text-xs">
                                ناموجود
                              </Badge>
                            )}
                            {item.quantity > 0 && item.quantity < 10 && (
                              <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                                کم
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{formatCurrency(item.costPrice)}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(item.totalValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Movements Tab */}
      <TabsContent value="movements" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>تاریخچه جابجایی‌های انبار</CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                هیچ جابجایی‌ای ثبت نشده است
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">نوع</TableHead>
                      <TableHead className="text-right">محصول</TableHead>
                      <TableHead className="text-right">تعداد</TableHead>
                      <TableHead className="text-right">مرجع</TableHead>
                      <TableHead className="text-right">طرف حساب</TableHead>
                      <TableHead className="text-right">تاریخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Badge
                            variant={m.type === 'SALE' ? 'destructive' : m.type === 'PURCHASE' || m.type === 'RETURN' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {m.type === 'SALE' && 'فروش'}
                            {m.type === 'PURCHASE' && 'خرید'}
                            {m.type === 'RETURN' && 'مرجوعی'}
                            {m.type === 'ADJUSTMENT' && 'تعدیل'}
                            {m.type === 'TRANSFER' && 'انتقال'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{m.productName}</TableCell>
                        <TableCell>
                          <span className={m.quantity < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.reference}</TableCell>
                        <TableCell>{m.counterpart}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Sales Tab */}
      <TabsContent value="sales" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>فروش‌های اخیر</CardTitle>
          </CardHeader>
          <CardContent>
            {recentOrderItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                هیچ فروشی ثبت نشده است
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">محصول</TableHead>
                      <TableHead className="text-right">تعداد</TableHead>
                      <TableHead className="text-right">مشتری</TableHead>
                      <TableHead className="text-right">شماره سفارش</TableHead>
                      <TableHead className="text-right">تاریخ</TableHead>
                      <TableHead className="text-right">مبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrderItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell>{item.quantity.toLocaleString('fa-IR')}</TableCell>
                        <TableCell>{item.customerName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          #{item.orderNumber}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.orderDate}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(item.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Purchases Tab */}
      <TabsContent value="purchases" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>خریدهای اخیر</CardTitle>
          </CardHeader>
          <CardContent>
            {recentPurchaseItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                هیچ خریدی ثبت نشده است
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">محصول</TableHead>
                      <TableHead className="text-right">تعداد</TableHead>
                      <TableHead className="text-right">تامین‌کننده</TableHead>
                      <TableHead className="text-right">شماره سفارش</TableHead>
                      <TableHead className="text-right">تاریخ</TableHead>
                      <TableHead className="text-right">مبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentPurchaseItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell>{item.quantity.toLocaleString('fa-IR')}</TableCell>
                        <TableCell>{item.supplierName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.orderNumber}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.orderDate}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(item.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Audits Tab */}
      <TabsContent value="audits" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>انبارگردانی‌های اخیر</CardTitle>
          </CardHeader>
          <CardContent>
            {recentAudits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                هیچ انبارگردانی ثبت نشده است
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">وضعیت</TableHead>
                      <TableHead className="text-right">ایجادکننده</TableHead>
                      <TableHead className="text-right">تاریخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentAudits.map((audit) => (
                      <TableRow key={audit.id}>
                        <TableCell>
                          <Badge
                            variant={
                              audit.status === 'COMPLETED'
                                ? 'default'
                                : audit.status === 'IN_PROGRESS'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {audit.status === 'COMPLETED' && 'تکمیل شده'}
                            {audit.status === 'IN_PROGRESS' && 'در حال انجام'}
                            {audit.status === 'PENDING' && 'در انتظار'}
                          </Badge>
                        </TableCell>
                        <TableCell>{audit.createdBy}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {audit.createdAt}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}


