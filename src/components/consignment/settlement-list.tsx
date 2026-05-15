'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaymentModal } from './payment-modal';
import { formatJalaliDate } from '@/lib/date-utils';
import { consolidateConsignmentOrders } from '@/actions/consignment';
import { useTransition } from 'react';
import { toast } from 'sonner';

interface SettlementListProps {
  settlements: any[];
  accounts: any[];
}

export function SettlementList({ settlements, accounts }: SettlementListProps) {
  const [isPending, startTransition] = useTransition();

  const handleConsolidate = () => {
    if (!confirm('سفارش‌های امانی موجود را بر اساس همکار و تاریخ ادغام می‌کنم. ادامه می‌دهید؟')) return;
    startTransition(async () => {
      const result = await consolidateConsignmentOrders();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message || 'خطا');
      }
    });
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>تسویه‌های در انتظار پرداخت</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleConsolidate}
          disabled={isPending}
          title="ادغام سفارش‌های قدیمی هر همکار در یک تاریخ به یک فاکتور"
        >
          {isPending ? 'در حال ادغام...' : 'ادغام سفارش‌های قدیمی'}
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">همکار</TableHead>
              <TableHead className="text-right">تاریخ</TableHead>
              <TableHead className="text-right">اقلام</TableHead>
              <TableHead className="text-right">فروش ناخالص</TableHead>
              <TableHead className="text-right">سهم همکار</TableHead>
              <TableHead className="text-right">سهم ما</TableHead>
              <TableHead className="text-right">پرداخت/باقی</TableHead>
              <TableHead className="text-right">وضعیت</TableHead>
              <TableHead className="text-right">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settlements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  هیچ تسویه‌ای در انتظار پرداخت نیست.
                </TableCell>
              </TableRow>
            ) : (
              settlements.map((s) => {
                const fullyPaid = s.remainingAmount <= 0.01;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.customer?.name || 'ناشناس'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatJalaliDate(s.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="max-h-[100px] overflow-y-auto text-xs">
                        {s.items.map((item: any) => (
                          <div key={item.id}>
                            {item.product?.name} × {item.quantity}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {Number(s.grossAmount).toLocaleString('fa-IR')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Number(s.commissionAmount).toLocaleString('fa-IR')}
                      {s.commissionRate > 0 && (
                        <span className="block text-[10px]">({s.commissionRate}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-green-700">
                      {Number(s.totalAmount).toLocaleString('fa-IR')}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>پرداخت: {Number(s.paidAmount).toLocaleString('fa-IR')}</div>
                      <div className="text-orange-600 font-medium">
                        باقی: {Number(s.remainingAmount).toLocaleString('fa-IR')}
                      </div>
                    </TableCell>
                    <TableCell>
                      {fullyPaid ? (
                        <Badge variant="default" className="bg-green-600">پرداخت شده</Badge>
                      ) : Number(s.paidAmount) > 0 ? (
                        <Badge variant="secondary">پرداخت جزئی</Badge>
                      ) : (
                        <Badge variant="outline">پرداخت نشده</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!fullyPaid && (
                        <PaymentModal
                          orderId={s.id}
                          totalAmount={Number(s.totalAmount)}
                          paidAmount={Number(s.paidAmount)}
                          remainingAmount={Number(s.remainingAmount)}
                          accounts={accounts}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
