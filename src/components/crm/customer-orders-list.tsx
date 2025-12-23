import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

import { formatJalaliDate } from '@/lib/date-utils';
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">شماره سفارش</TableHead>
            <TableHead>تاریخ</TableHead>
            <TableHead>مبلغ کل</TableHead>
            <TableHead>پرداخت شده</TableHead>
            <TableHead>وضعیت پرداخت</TableHead>
            <TableHead>وضعیت سفارش</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                هیچ سفارشی یافت نشد.
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.number}</TableCell>
                <TableCell>
                  {formatJalaliDate(order.createdAt)}
                </TableCell>
                <TableCell>
                  {new Intl.NumberFormat('fa-IR').format(Number(order.totalAmount))}
                </TableCell>
                <TableCell>
                  {new Intl.NumberFormat('fa-IR').format(Number(order.paidAmount))}
                </TableCell>
                <TableCell>
                  <Badge variant={
                    order.paymentStatus === 'PAID' ? 'default' : 
                    order.paymentStatus === 'PARTIAL' ? 'secondary' : 'destructive'
                  }>
                    {order.paymentStatus === 'PAID' ? 'پرداخت شده' :
                     order.paymentStatus === 'PARTIAL' ? 'پرداخت ناقص' : 'پرداخت نشده'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{order.status}</Badge>
                </TableCell>
                <TableCell className="text-left">
                  <Link href={`/dashboard/sales/history/${order.id}`}>
                    <Button variant="ghost" size="icon">
                        <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
