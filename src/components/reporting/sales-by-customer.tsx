'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface SalesByCustomerProps {
  data: {
    topCustomers: {
      name: string;
      count: number;
      total: number;
    }[];
  };
}

export function SalesByCustomer({ data }: SalesByCustomerProps) {
  return (
    <Card className="col-span-1">
      <CardHeader>
        <CardTitle>فروش بر اساس مشتری (۱۰ برتر)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">نام مشتری</TableHead>
              <TableHead className="text-center">تعداد سفارش</TableHead>
              <TableHead className="text-right">مبلغ کل (تومان)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.topCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                  اطلاعاتی یافت نشد.
                </TableCell>
              </TableRow>
            ) : (
              data.topCustomers.map((customer, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-center">{customer.count}</TableCell>
                  <TableCell>{customer.total.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
