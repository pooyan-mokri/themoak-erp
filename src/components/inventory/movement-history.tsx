'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { History, ArrowUp, ArrowDown } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';

interface Movement {
  id: string;
  date: Date | string;
  dateFormatted?: string;
  type: 'SALE' | 'PURCHASE';
  quantity: number;
  reference: string;
  status: string;
}

interface MovementHistoryProps {
  movements: Movement[];
}

export function MovementHistory({ movements }: MovementHistoryProps) {
  const getMovementBadge = (type: string) => {
    if (type === 'SALE') {
      return (
        <Badge variant="destructive" className="gap-1">
          <ArrowDown className="h-3 w-3" />
          فروش
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="gap-1">
        <ArrowUp className="h-3 w-3" />
        خرید
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: any; label: string }> = {
      COMPLETED: { variant: 'secondary', label: 'تکمیل شده' },
      CONFIRMED: { variant: 'default', label: 'تأیید شده' },
      DELIVERED: { variant: 'secondary', label: 'تحویل داده شده' },
      RECEIVED: { variant: 'secondary', label: 'دریافت شده' },
      CANCELLED: { variant: 'destructive', label: 'لغو شده' },
      DRAFT: { variant: 'outline', label: 'پیش‌نویس' },
    };

    const config = statusMap[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          تاریخچه حرکت‌ها (20 مورد اخیر)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            هیچ حرکتی برای این محصول ثبت نشده است
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">تاریخ</TableHead>
                  <TableHead className="text-right">نوع</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">مرجع</TableHead>
                  <TableHead className="text-right">وضعیت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="font-medium">
                      {movement.dateFormatted || formatJalaliDate(movement.date, 'jYYYY/jMM/jDD HH:mm')}
                    </TableCell>
                    <TableCell>{getMovementBadge(movement.type)}</TableCell>
                    <TableCell>
                      <span className={`font-bold ${movement.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {movement.quantity > 0 ? '+' : ''}{movement.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {movement.reference}
                    </TableCell>
                    <TableCell>{getStatusBadge(movement.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
