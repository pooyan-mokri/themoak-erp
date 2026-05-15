'use client';

import { useState, useTransition } from 'react';
import { getPartnerStatement } from '@/actions/consignment';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatJalaliDate } from '@/lib/date-utils';

interface Partner {
  id: string;
  name: string;
  customer?: { name: string };
}

type Statement = Awaited<ReturnType<typeof getPartnerStatement>>;

function fmt(n: number) {
  return n.toLocaleString('fa-IR');
}

export function PartnerStatementView({ partners }: { partners: Partner[] }) {
  const [selected, setSelected] = useState('');
  const [statement, setStatement] = useState<Statement>(undefined);
  const [isPending, startTransition] = useTransition();

  const onSelect = (warehouseId: string) => {
    setSelected(warehouseId);
    startTransition(async () => {
      const s = await getPartnerStatement(warehouseId);
      setStatement(s);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>انتخاب همکار</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-2">
            <Label>همکار امانی</Label>
            <Select value={selected} onValueChange={onSelect}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب همکار" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.customer?.name || p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isPending && (
        <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p>
      )}

      {!isPending && statement && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  موجودی فعلی نزد همکار
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fmt(statement.logistics.currentStockQty)} عدد
                </div>
                <p className="text-xs text-muted-foreground">
                  ارزش: {fmt(statement.logistics.currentStockValue)} تومان
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  کل ارسالی / فروخته / برگشتی
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">
                  {fmt(statement.logistics.sentQty)} / {fmt(statement.logistics.soldQty)} /{' '}
                  {fmt(statement.logistics.returnedQty)}
                </div>
                <p className="text-xs text-muted-foreground">عدد</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  سهم ما (خالص)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700">
                  {fmt(statement.financials.ourShare)}
                </div>
                <p className="text-xs text-muted-foreground">
                  ناخالص: {fmt(statement.financials.grossSales)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  مانده طلب از همکار
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {fmt(statement.financials.balance)}
                </div>
                <p className="text-xs text-muted-foreground">
                  دریافتی: {fmt(statement.financials.receivedTotal)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>خلاصه مالی</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm max-w-md">
                <div className="flex justify-between">
                  <span>فروش ناخالص کل:</span>
                  <span className="font-medium">{fmt(statement.financials.grossSales)} تومان</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>سهم همکار (کمیسیون {statement.partner.commissionRate}%):</span>
                  <span>{fmt(statement.financials.commissionTotal)} تومان</span>
                </div>
                <div className="flex justify-between border-t pt-2 font-bold">
                  <span>سهم ما (خالص):</span>
                  <span className="text-green-700">{fmt(statement.financials.ourShare)} تومان</span>
                </div>
                <div className="flex justify-between">
                  <span>دریافت‌شده:</span>
                  <span>{fmt(statement.financials.receivedTotal)} تومان</span>
                </div>
                <div className="flex justify-between border-t pt-2 font-bold">
                  <span>مانده:</span>
                  <span className="text-orange-600">{fmt(statement.financials.balance)} تومان</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>موجودی فعلی نزد همکار</CardTitle>
            </CardHeader>
            <CardContent>
              {statement.currentStock.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  هیچ کالایی نزد این همکار نیست.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">محصول</TableHead>
                      <TableHead className="text-right">SKU</TableHead>
                      <TableHead className="text-right">تعداد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.currentStock.map((s: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.productName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.sku}</TableCell>
                        <TableCell>{fmt(s.quantity)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>فاکتورهای فروش</CardTitle>
            </CardHeader>
            <CardContent>
              {statement.orders.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  هیچ فاکتوری ثبت نشده است.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">شماره</TableHead>
                      <TableHead className="text-right">تاریخ</TableHead>
                      <TableHead className="text-right">اقلام</TableHead>
                      <TableHead className="text-right">ناخالص</TableHead>
                      <TableHead className="text-right">سهم ما</TableHead>
                      <TableHead className="text-right">پرداخت</TableHead>
                      <TableHead className="text-right">وضعیت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.orders.map((o: any) => (
                      <TableRow key={o.id}>
                        <TableCell>#{o.number}</TableCell>
                        <TableCell className="text-xs">{formatJalaliDate(o.createdAt)}</TableCell>
                        <TableCell>{fmt(o.itemCount)}</TableCell>
                        <TableCell className="text-xs">{fmt(o.gross)}</TableCell>
                        <TableCell className="font-medium text-green-700">{fmt(o.net)}</TableCell>
                        <TableCell className="text-xs">{fmt(o.paid)}</TableCell>
                        <TableCell>
                          {o.paymentStatus === 'PAID' ? (
                            <Badge className="bg-green-600">پرداخت شده</Badge>
                          ) : o.paid > 0 ? (
                            <Badge variant="secondary">جزئی</Badge>
                          ) : (
                            <Badge variant="outline">پرداخت نشده</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
