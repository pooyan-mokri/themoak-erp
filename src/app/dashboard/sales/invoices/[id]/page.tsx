import { getInvoiceById } from '@/actions/invoice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Printer, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatJalaliDate } from '@/lib/date-utils';
export default async function InvoiceDetailsPage({ params }: { params: { id: string } }) {
  const invoice = await getInvoiceById(params.id);

  if (!invoice) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/sales/invoices">
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">فاکتور {invoice.invoiceNumber}</h1>
          <Badge variant={invoice.status === 'PAID' ? 'default' : 'secondary'} className="mr-2">
            {invoice.status === 'PAID' ? 'پرداخت شده' : invoice.status}
          </Badge>
        </div>
        <Link href={`/dashboard/sales/invoices/${invoice.id}/print`} target="_blank">
          <Button variant="outline">
            <Printer className="mr-2 h-4 w-4" />
            چاپ فاکتور
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>اطلاعات فاکتور</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاریخ صدور:</span>
              <span>{formatJalaliDate(invoice.issueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">سررسید:</span>
              <span>{formatJalaliDate(invoice.dueDate)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg mt-4">
              <span>مبلغ کل:</span>
              <span>{new Intl.NumberFormat('fa-IR').format(Number(invoice.total))} تومان</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>پرداخت شده:</span>
              <span>{new Intl.NumberFormat('fa-IR').format(Number(invoice.paidAmount))} تومان</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>اطلاعات مشتری</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">نام:</span>
              <span>{invoice.customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">تلفن:</span>
              <span>{invoice.customer.phone || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">آدرس:</span>
              <span className="max-w-[200px] truncate">{invoice.customer.address || '-'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
