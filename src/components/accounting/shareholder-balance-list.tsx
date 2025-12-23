'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ShareholderWithBalance {
  id: string;
  name: string;
  percentage: number;
  balance: number; // Positive = company owes shareholder, Negative = shareholder owes company
}

interface ShareholderBalanceListProps {
  shareholders: ShareholderWithBalance[];
}

export function ShareholderBalanceList({ shareholders }: ShareholderBalanceListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>موجودی و بدهی سهامداران</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          مقدار مثبت = سیستم به سهامدار بدهکار است (Accounts Payable)
          <br />
          مقدار منفی = سهامدار به سیستم بدهکار است (Accounts Receivable)
        </p>
      </CardHeader>
      <CardContent>
        {shareholders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            هیچ سهامدار ثبت نشده است.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام سهامدار</TableHead>
                <TableHead>درصد سهام</TableHead>
                <TableHead>موجودی/بدهی</TableHead>
                <TableHead>نوع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shareholders.map((shareholder) => (
                <TableRow key={shareholder.id}>
                  <TableCell className="font-medium">{shareholder.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{shareholder.percentage.toFixed(2)}%</Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`font-bold ${
                        shareholder.balance > 0
                          ? 'text-blue-600'
                          : shareholder.balance < 0
                          ? 'text-red-600'
                          : 'text-gray-600'
                      }`}
                    >
                      {Math.abs(shareholder.balance).toLocaleString('fa-IR')} تومان
                    </span>
                  </TableCell>
                  <TableCell>
                    {shareholder.balance > 0 ? (
                      <Badge variant="default" className="bg-blue-500">
                        سیستم بدهکار است
                      </Badge>
                    ) : shareholder.balance < 0 ? (
                      <Badge variant="destructive">
                        سهامدار بدهکار است
                      </Badge>
                    ) : (
                      <Badge variant="outline">بدون بدهی</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

