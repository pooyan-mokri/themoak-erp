'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface InventoryValuationProps {
  data: {
    totalValue: number;
    byWarehouse: {
      name: string;
      value: number;
      itemCount: number;
    }[];
  };
}

export function InventoryValuation({ data }: InventoryValuationProps) {
  return (
    <Card className="col-span-1">
      <CardHeader>
        <CardTitle>ارزش موجودی انبار</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="text-sm font-medium text-muted-foreground">ارزش کل موجودی</div>
          <div className="text-2xl font-bold">{data.totalValue.toLocaleString()} تومان</div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">نام انبار</TableHead>
              <TableHead className="text-center">تعداد کالا</TableHead>
              <TableHead className="text-right">ارزش (تومان)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byWarehouse.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                  اطلاعاتی یافت نشد.
                </TableCell>
              </TableRow>
            ) : (
              data.byWarehouse.map((warehouse, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{warehouse.name}</TableCell>
                  <TableCell className="text-center">{warehouse.itemCount}</TableCell>
                  <TableCell>{warehouse.value.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
