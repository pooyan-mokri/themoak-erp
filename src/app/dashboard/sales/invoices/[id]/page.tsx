import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Printer, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InvoiceTable } from '@/components/sales/invoice-document';
import { invoiceOrderId, loadInvoiceData } from '@/lib/invoice-data';
import { invoiceStatusLabel } from '@/lib/invoice-lines';

import { formatJalaliDate } from '@/lib/date-utils';
import { requireRouteAccess } from '@/lib/access';
export default async function InvoiceDetailsPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  await requireRouteAccess('/dashboard/sales');
  const params = await paramsPromise;
  const orderId = await invoiceOrderId(params.id);
  const data = orderId ? await loadInvoiceData(orderId) : null;

  if (!data || !data.invoice) {
    notFound();
  }
  const invoice = data.invoice;
  const toman = (amount: number) => Math.round(amount).toLocaleString('fa-IR');

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
            {invoiceStatusLabel(invoice.status)}
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
              <span className="text-muted-foreground">سفارش:</span>
              <Link href={`/dashboard/sales/history/${data.orderId}`} className="hover:underline">
                #{data.orderNumber}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاریخ صدور:</span>
              <span>{formatJalaliDate(invoice.issueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">سررسید:</span>
              <span>{formatJalaliDate(invoice.dueDate)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg mt-4">
              <span>مبلغ قابل پرداخت:</span>
              <span>{toman(data.bill.net)} تومان</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>پرداخت شده:</span>
              <span>{toman(data.bill.paid)} تومان</span>
            </div>
            {data.bill.credit > 0 ? (
              <div className="flex justify-between text-success">
                <span>بستانکار:</span>
                <span>{toman(data.bill.credit)} تومان</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span>باقی‌مانده:</span>
                <span>{toman(data.bill.remaining)} تومان</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>اطلاعات مشتری</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">نام:</span>
              <span>{data.customer?.name || 'مشتری عمومی'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">تلفن:</span>
              <span>{data.customer?.phone || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">آدرس:</span>
              <span className="max-w-[200px] truncate">{data.buyerAddress}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>اقلام فاکتور</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceTable bill={data.bill} />
        </CardContent>
      </Card>
    </div>
  );
}
