'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Eye, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { formatJalaliDate } from '@/lib/date-utils';
interface Invoice {
  id: string;
  invoiceNumber: string;
  customer: {
    name: string;
  };
  issueDate: Date;
  dueDate: Date;
  total: any;
  paidAmount: any;
  status: string;
}

interface InvoiceListProps {
  invoices: Invoice[];
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>شماره فاکتور</TableHead>
            <TableHead>مشتری</TableHead>
            <TableHead>تاریخ صدور</TableHead>
            <TableHead>سررسید</TableHead>
            <TableHead>مبلغ کل</TableHead>
            <TableHead>پرداخت شده</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                هیچ فاکتوری یافت نشد.
              </TableCell>
            </TableRow>
          ) : (
            invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                <TableCell>{invoice.customer.name}</TableCell>
                <TableCell>
                  {formatJalaliDate(invoice.issueDate)}
                </TableCell>
                <TableCell>
                  {formatJalaliDate(invoice.dueDate)}
                </TableCell>
                <TableCell>
                  {new Intl.NumberFormat('fa-IR').format(Number(invoice.total))}
                </TableCell>
                <TableCell>
                  {new Intl.NumberFormat('fa-IR').format(Number(invoice.paidAmount))}
                </TableCell>
                <TableCell>
                  <Badge variant={
                    invoice.status === 'PAID' ? 'default' : 
                    invoice.status === 'PARTIAL' ? 'secondary' : 
                    invoice.status === 'OVERDUE' ? 'destructive' : 'outline'
                  }>
                    {invoice.status === 'PAID' ? 'پرداخت شده' :
                     invoice.status === 'PARTIAL' ? 'پرداخت ناقص' :
                     invoice.status === 'OVERDUE' ? 'سررسید گذشته' : 'پرداخت نشده'}
                  </Badge>
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/sales/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                        </Button>
                    </Link>
                    <Link href={`/dashboard/sales/invoices/${invoice.id}/print`} target="_blank">
                        <Button variant="ghost" size="icon">
                            <Printer className="h-4 w-4" />
                        </Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
