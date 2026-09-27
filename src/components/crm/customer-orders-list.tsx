import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, fa, orderPayment } from './crm-labels';

interface Order {
  id: string;
  number: number;
  totalAmount: any; // Decimal
  paidAmount: any; // Decimal
  paymentStatus: string;
  status: string;
  createdAt: Date;
  items: any[];
}

interface CustomerOrdersListProps {
  orders: Order[];
}

export function CustomerOrdersList({ orders }: CustomerOrdersListProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">سفارش</TableHead>
            <TableHead>تاریخ</TableHead>
            <TableHead className="text-end">مبلغ کل (تومان)</TableHead>
            <TableHead className="text-end">پرداخت شده</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                این مشتری هنوز سفارشی ندارد.
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => {
              const status = orderPayment(order);
              return (
                <TableRow key={order.id}>
                  <TableCell className="font-mono font-bold">#{order.number}</TableCell>
                  <TableCell className="font-mono text-[12px] text-muted-foreground">{formatJalaliDate(order.createdAt)}</TableCell>
                  <TableCell className="text-end">{fa(Number(order.totalAmount))}</TableCell>
                  <TableCell className="text-end text-muted-foreground">{fa(Number(order.paidAmount))}</TableCell>
                  <TableCell>
                    <span className={cn(PILL, status.tone)}>{status.label}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="جزئیات سفارش">
                      <Link href={`/dashboard/sales/history/${order.id}`}>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
