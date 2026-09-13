import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatJalaliDateTime } from '@/lib/date-utils';
import { TAG_NEEDS_REVIEW, formatShipTo, type SiteOrderData } from '@/lib/site-sale-data';

export type SiteRefundRow = { refundId: string; amount: number; at: Date | string };

const STATUS_LABELS: Record<string, string> = {
  shipped: 'ارسال شد',
  delivered: 'تحویل شد',
  returned: 'مرجوع شد',
  refunded: 'بازپرداخت شد',
  cancelled: 'لغو شد',
};

const toman = (amount: number) => `${amount.toLocaleString('fa-IR')} تومان`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <span dir="ltr" className="font-mono text-xs">{children}</span>;
}

interface SiteOrderCardProps {
  reference: string;
  data?: SiteOrderData;
  refunds: SiteRefundRow[];
}

/** What the website sent with an order, and what it has reported since. Read-only. */
export function SiteOrderCard({ reference, data, refunds }: SiteOrderCardProps) {
  const review = data?.review ?? [];
  const unknownLines = data?.unknownLines ?? [];
  const history = data?.history ?? [];
  const address = formatShipTo(data?.shipTo);
  const shipping = data?.shipping;
  const payment = data?.payment;
  const freight = shipping?.free ? 'رایگان' : shipping?.freight != null ? toman(shipping.freight) : null;
  const trackingCode =
    [...history].reverse().find((event) => event.trackingCode)?.trackingCode ?? shipping?.trackingCode ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>سفارش سایت</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {review.length > 0 && (
          <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-amber-800">
            <div className="font-semibold">{TAG_NEEDS_REVIEW}</div>
            <ul className="mt-1 list-disc space-y-1 pr-5 text-sm">
              {review.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <Row label="مرجع">
            <Code>{reference}</Code>
          </Row>
          {data?.issuedAt && <Row label="ثبت در سایت">{formatJalaliDateTime(data.issuedAt)}</Row>}
          {address && <Row label="نشانی ارسال">{address}</Row>}
          {data?.shipTo?.note && <Row label="یادداشت ارسال">{data.shipTo.note}</Row>}
        </div>

        {(shipping?.carrier || freight || trackingCode) && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">ارسال</div>
            {shipping?.carrier && <Row label="شرکت حمل">{shipping.carrier}</Row>}
            {freight && <Row label="هزینهٔ ارسال">{freight}</Row>}
            {trackingCode && (
              <Row label="کد رهگیری">
                <Code>{trackingCode}</Code>
              </Row>
            )}
          </div>
        )}

        {payment && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">پرداخت</div>
            {payment.gateway && <Row label="درگاه">{payment.gateway}</Row>}
            {payment.trackId && (
              <Row label="شناسهٔ پیگیری">
                <Code>{payment.trackId}</Code>
              </Row>
            )}
            {payment.refNumber && (
              <Row label="شمارهٔ مرجع">
                <Code>{payment.refNumber}</Code>
              </Row>
            )}
            {payment.paidAt && <Row label="زمان پرداخت">{formatJalaliDateTime(payment.paidAt)}</Row>}
            <Row label="مبلغ">{toman(payment.amount)}</Row>
          </div>
        )}

        {unknownLines.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">اقلام ناشناخته</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">شناسهٔ وب</TableHead>
                  <TableHead className="text-right">نام</TableHead>
                  <TableHead className="text-right">تعداد</TableHead>
                  <TableHead className="text-right">قیمت واحد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unknownLines.map((line, i) => (
                  <TableRow key={i}>
                    <TableCell>{line.webId ? <Code>{line.webId}</Code> : '—'}</TableCell>
                    <TableCell>{line.name || '—'}</TableCell>
                    <TableCell>{line.quantity.toLocaleString('fa-IR')}</TableCell>
                    <TableCell>{toman(line.unitPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">تاریخچهٔ وضعیت</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">وضعیت</TableHead>
                  <TableHead className="text-right">زمان</TableHead>
                  <TableHead className="text-right">کد رهگیری</TableHead>
                  <TableHead className="text-right">مبلغ</TableHead>
                  <TableHead className="text-right">بازگشت به انبار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((event, i) => (
                  <TableRow key={i}>
                    <TableCell>{STATUS_LABELS[event.status] ?? event.status}</TableCell>
                    <TableCell>{formatJalaliDateTime(event.at)}</TableCell>
                    <TableCell>{event.trackingCode ? <Code>{event.trackingCode}</Code> : '—'}</TableCell>
                    <TableCell>{event.amount != null ? toman(event.amount) : '—'}</TableCell>
                    <TableCell>{event.restock == null ? '—' : event.restock ? 'بله' : 'خیر'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {refunds.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">بازپرداخت‌ها</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">شناسهٔ بازپرداخت</TableHead>
                  <TableHead className="text-right">مبلغ</TableHead>
                  <TableHead className="text-right">زمان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refunds.map((refund) => (
                  <TableRow key={refund.refundId}>
                    <TableCell>
                      <Code>{refund.refundId}</Code>
                    </TableCell>
                    <TableCell>{toman(refund.amount)}</TableCell>
                    <TableCell>{formatJalaliDateTime(refund.at)}</TableCell>
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
