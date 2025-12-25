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
import { Package, ShoppingCart, ShoppingBag, ClipboardCheck } from 'lucide-react';
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

interface WarehouseDetailViewProps {
  inventory: InventoryItem[];
  recentOrderItems: OrderItem[];
  recentPurchaseItems: PurchaseItem[];
  recentAudits: Audit[];
  lowStockItems: InventoryItem[];
  topProductsByValue: InventoryItem[];
}

export function WarehouseDetailView({
  inventory,
  recentOrderItems,
  recentPurchaseItems,
  recentAudits,
  lowStockItems,
  topProductsByValue,
}: WarehouseDetailViewProps) {
  return (
    <Tabs defaultValue="inventory" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="inventory">
          <Package className="h-4 w-4 ml-2" />
          موجودی ({inventory.length})
        </TabsTrigger>
        <TabsTrigger value="sales">
          <ShoppingCart className="h-4 w-4 ml-2" />
          فروش‌های اخیر
        </TabsTrigger>
        <TabsTrigger value="purchases">
          <ShoppingBag className="h-4 w-4 ml-2" />
          خریدهای اخیر
        </TabsTrigger>
        <TabsTrigger value="audits">
          <ClipboardCheck className="h-4 w-4 ml-2" />
          انبارگردانی‌ها
        </TabsTrigger>
      </TabsList>

      {/* Inventory Tab */}
      <TabsContent value="inventory" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>لیست موجودی انبار</CardTitle>
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


