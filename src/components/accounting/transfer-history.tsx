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
import { Badge } from '@/components/ui/badge';
import { formatJalaliDate } from '@/lib/date-utils';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { deleteInternalTransfer } from '@/actions/accounting';
import { TransferEditDialog } from './transfer-edit-dialog';

interface TransferHistoryProps {
  transfers: Array<{
    id: string;
    date: Date;
    fromAccountId: string | null;
    toAccountId: string | null;
    fromAccount: string | null;
    toAccount: string | null;
    amount: number;
    currency: string;
    description: string;
    complete: boolean;
  }>;
  /** May correct or remove a recorded transfer (admin only). */
  isAdmin?: boolean;
  accounts?: Array<{ id: string; name: string; currency: string; balance: number; cardNumber?: string | null }>;
}

export function TransferHistory({ transfers, isAdmin = false, accounts = [] }: TransferHistoryProps) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    const result = await deleteInternalTransfer(id);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>تاریخچه انتقال‌ها</CardTitle>
      </CardHeader>
      <CardContent>
        {transfers.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">تاریخ</TableHead>
                  <TableHead className="text-right">از حساب</TableHead>
                  <TableHead className="text-right">به حساب</TableHead>
                  <TableHead className="text-right">مبلغ</TableHead>
                  <TableHead className="text-right">توضیحات</TableHead>
                  {isAdmin && <TableHead className="w-[100px] text-left">عملیات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{formatJalaliDate(transfer.date)}</span>
                        {!transfer.complete && (
                          <Badge variant="destructive" className="text-xs">
                            سند ناقص
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{transfer.fromAccount ?? '—'}</TableCell>
                    <TableCell>{transfer.toAccount ?? '—'}</TableCell>
                    <TableCell className="font-medium">
                      {new Intl.NumberFormat('fa-IR').format(transfer.amount)} {transfer.currency}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{transfer.description || '-'}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-left">
                        <div className="flex justify-end gap-1">
                          <TransferEditDialog transfer={transfer} accounts={accounts} />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>حذف انتقال وجه</AlertDialogTitle>
                                <AlertDialogDescription>
                                  آیا از حذف این سند اطمینان دارید؟ مبلغ به حساب مبدأ برمی‌گردد و از حساب مقصد کم می‌شود. این عملیات قابل بازگشت نیست.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>انصراف</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(transfer.id)}
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
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">هیچ انتقال وجهی ثبت نشده است.</div>
        )}
      </CardContent>
    </Card>
  );
}
