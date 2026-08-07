'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, PackagePlus, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { formatJalaliDate } from '@/lib/date-utils';
import { repairCancelledOrderStock, type LostStockOrder } from '@/actions/lost-stock';

export function LostStockList({ orders, isAdmin }: { orders: LostStockOrder[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const handleRepair = async (orderId: string) => {
    setBusy(orderId);
    const result = await repairCancelledOrderStock(orderId);
    setBusy(null);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
          <p className="font-medium">موردی یافت نشد</p>
          <p className="text-sm text-muted-foreground">
            هیچ سفارش لغوشده‌ای با موجودی بازنگشته وجود ندارد.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalUnits = orders.reduce((s, o) => s + o.totalUnits, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-2xl font-bold">{orders.length.toLocaleString('fa-IR')}</div>
            <div className="text-xs text-muted-foreground mt-1">سفارش لغوشده</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-2xl font-bold text-orange-600">{totalUnits.toLocaleString('fa-IR')}</div>
            <div className="text-xs text-muted-foreground mt-1">عدد کالای بازنگشته</div>
          </CardContent>
        </Card>
      </div>

      {orders.map((order) => (
        <Card key={order.orderId}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                سفارش #{order.number}
                <Badge variant="outline">{order.customerName}</Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  {formatJalaliDate(order.createdAt)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Link href={`/dashboard/sales/history/${order.orderId}`}>
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 ml-1" />
                    جزئیات
                  </Button>
                </Link>
                {isAdmin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={busy === order.orderId}>
                        <PackagePlus className="h-4 w-4 ml-1" />
                        {busy === order.orderId ? 'در حال ترمیم...' : 'ترمیم موجودی'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>ترمیم موجودی سفارش #{order.number}</AlertDialogTitle>
                        <AlertDialogDescription>
                          مجموعاً {order.totalUnits.toLocaleString('fa-IR')} عدد کالا به انبار بازگردانده می‌شود.
                          انبار مقصد به‌صورت خودکار تشخیص داده می‌شود و در گردش انبار ثبت می‌گردد.
                          پیش از تأیید مطمئن شوید این کالاها واقعاً به انبار برنگشته‌اند.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>انصراف</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRepair(order.orderId)}>
                          تأیید و بازگرداندن
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">محصول</TableHead>
                    <TableHead className="text-right">کد کالا</TableHead>
                    <TableHead className="text-right w-[110px]">تعداد بازنگشته</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line) => (
                    <TableRow key={line.orderItemId}>
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{line.sku}</TableCell>
                      <TableCell className="font-semibold text-orange-600">
                        {line.quantity.toLocaleString('fa-IR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
