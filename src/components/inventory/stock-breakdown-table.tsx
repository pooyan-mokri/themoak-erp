'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Warehouse, AlertTriangle, CheckCircle } from 'lucide-react';

interface StockBreakdownItem {
  warehouseId: string;
  warehouseName: string;
  isVirtual: boolean;
  quantity: number;
  status: string;
}

interface StockBreakdownTableProps {
  breakdown: StockBreakdownItem[];
}

export function StockBreakdownTable({ breakdown }: StockBreakdownTableProps) {
  const getStatusBadge = (status: string) => {
    if (status === 'LOW') {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          موجودی پایین
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle className="h-3 w-3" />
        عادی
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Warehouse className="h-5 w-5" />
          توزیع موجودی در انبارها
        </CardTitle>
      </CardHeader>
      <CardContent>
        {breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            این محصول در هیچ انباری موجودی ندارد
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">انبار</TableHead>
                  <TableHead className="text-right">نوع</TableHead>
                  <TableHead className="text-right">موجودی</TableHead>
                  <TableHead className="text-right">وضعیت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((item) => (
                  <TableRow key={item.warehouseId}>
                    <TableCell className="font-medium">{item.warehouseName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {item.isVirtual ? 'مجازی (مرسوله)' : 'فیزیکی'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-lg font-bold">{item.quantity}</span>
                    </TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={2} className="font-bold">جمع کل</TableCell>
                  <TableCell className="font-bold text-lg">
                    {breakdown.reduce((sum, item) => sum + item.quantity, 0)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
