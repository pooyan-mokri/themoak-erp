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
import { Currency } from '@/lib/types';
import { formatJalaliDate } from '@/lib/date-utils';
import { Badge } from '@/components/ui/badge';

interface CurrencyExchangeHistoryProps {
  history: Array<{
    id: string;
    date: Date;
    sourceAccount: string;
    targetAccount: string;
    sourceAmount: number;
    targetAmount: number;
    sourceCurrency: Currency;
    targetCurrency: Currency;
    exchangeRate: number;
    description?: string;
  }>;
}

export function CurrencyExchangeHistory({ history }: CurrencyExchangeHistoryProps) {
  const formatCurrency = (amount: number, currency: Currency) => {
    return new Intl.NumberFormat('fa-IR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ` ${currency}`;
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR', {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(num);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>تاریخچه معاملات ارز</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">تاریخ</TableHead>
                <TableHead className="text-right">حساب مبدا</TableHead>
                <TableHead className="text-right">مبلغ مبدا</TableHead>
                <TableHead className="text-right">حساب مقصد</TableHead>
                <TableHead className="text-right">مبلغ مقصد</TableHead>
                <TableHead className="text-right">نرخ تبدیل</TableHead>
                <TableHead className="text-right">توضیحات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((exchange) => (
                <TableRow key={exchange.id} className="animate-fade-in-up">
                  <TableCell>{formatJalaliDate(exchange.date)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{exchange.sourceAccount}</span>
                      <Badge variant="outline" className="text-xs">
                        {exchange.sourceCurrency}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(exchange.sourceAmount, exchange.sourceCurrency)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{exchange.targetAccount}</span>
                      <Badge variant="outline" className="text-xs">
                        {exchange.targetCurrency}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium text-green-600">
                    {formatCurrency(exchange.targetAmount, exchange.targetCurrency)}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">
                      {formatNumber(exchange.exchangeRate)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {exchange.description || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            هیچ معامله ارزی ثبت نشده است.
          </div>
        )}
      </CardContent>
    </Card>
  );
}




