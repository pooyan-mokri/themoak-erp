'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { formatJalaliDate } from '@/lib/date-utils';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { deleteCurrencyExchange } from '@/actions/currency-exchange';
import { CurrencyExchangeEditDialog } from './currency-exchange-edit-dialog';

interface CurrencyExchangeHistoryProps {
  history: Array<{
    id: string;
    date: Date;
    sourceAccountId: string | null;
    targetAccountId: string | null;
    sourceAccount: string | null;
    targetAccount: string | null;
    sourceAmount: number | null;
    targetAmount: number | null;
    sourceCurrency: Currency | null;
    targetCurrency: Currency | null;
    exchangeRate: number;
    description?: string;
    complete: boolean;
  }>;
  /** May correct or remove a recorded exchange (admin only). */
  isAdmin?: boolean;
  accounts?: Array<{ id: string; name: string; currency: Currency }>;
}

export function CurrencyExchangeHistory({ history, isAdmin = false, accounts = [] }: CurrencyExchangeHistoryProps) {
  const router = useRouter();

  const formatCurrency = (amount: number | null, currency: Currency | null) => {
    if (amount === null || currency === null) return '—';
    return (
      new Intl.NumberFormat('fa-IR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount) + ` ${currency}`
    );
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR', {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(num);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteCurrencyExchange(id);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const account = (id: string | null, name: string | null, currency: Currency | null) => (
    <div className="flex items-center gap-2">
      <span>{name ?? '—'}</span>
      {currency && (
        <Badge variant="outline" className="text-xs">
          {currency}
        </Badge>
      )}
    </div>
  );

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
                {isAdmin && <TableHead className="w-[100px] text-left">عملیات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((exchange) => (
                <TableRow key={exchange.id} className="animate-fade-in-up">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{formatJalaliDate(exchange.date)}</span>
                      {!exchange.complete && (
                        <Badge variant="destructive" className="text-xs">
                          سند ناقص
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {account(exchange.sourceAccountId, exchange.sourceAccount, exchange.sourceCurrency)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(exchange.sourceAmount, exchange.sourceCurrency)}
                  </TableCell>
                  <TableCell>
                    {account(exchange.targetAccountId, exchange.targetAccount, exchange.targetCurrency)}
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
                  {isAdmin && (
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-1">
                        <CurrencyExchangeEditDialog exchange={exchange} accounts={accounts} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف معامله ارز</AlertDialogTitle>
                              <AlertDialogDescription>
                                آیا از حذف این سند اطمینان دارید؟ مبلغ‌ها به حساب مبدا و مقصد برمی‌گردد. این عملیات قابل بازگشت نیست.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>انصراف</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(exchange.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
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
