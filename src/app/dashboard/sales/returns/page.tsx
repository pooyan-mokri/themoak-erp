import { getAllOrderReturns } from '@/actions/order-return';
import { getAllOrderExchanges } from '@/actions/order-exchange';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BackButton } from '@/components/ui/back-button';
import { formatJalaliDateTime } from '@/lib/date-utils';
import Link from 'next/link';

export default async function ReturnsHistoryPage() {
  const [returns, exchanges] = await Promise.all([
    getAllOrderReturns(),
    getAllOrderExchanges(),
  ]);

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/sales" label="بازگشت به فروش" />
      <h1 className="text-3xl font-bold tracking-tight">تاریخچه عودت‌ها و تعویض‌ها</h1>

      <Tabs defaultValue="returns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="returns">عودت‌ها ({returns.length})</TabsTrigger>
          <TabsTrigger value="exchanges">تعویض‌ها ({exchanges.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="returns">
          <Card>
            <CardHeader>
              <CardTitle>لیست عودت‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              {returns.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ عودتی ثبت نشده است.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>سفارش</TableHead>
                      <TableHead>مشتری</TableHead>
                      <TableHead>کالا</TableHead>
                      <TableHead>تعداد</TableHead>
                      <TableHead>مبلغ بازگشتی</TableHead>
                      <TableHead>حساب</TableHead>
                      <TableHead>دلیل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((ret: any) => (
                      <TableRow key={ret.id}>
                        <TableCell>{formatJalaliDateTime(ret.createdAt)}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/sales/history/${ret.orderId}`} className="text-blue-600 hover:underline">
                            #{ret.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{ret.customerName}</TableCell>
                        <TableCell>{ret.productName}</TableCell>
                        <TableCell>{ret.quantity}</TableCell>
                        <TableCell>{ret.refundAmount.toLocaleString()} تومان</TableCell>
                        <TableCell>{ret.accountName}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{ret.reason || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exchanges">
          <Card>
            <CardHeader>
              <CardTitle>لیست تعویض‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              {exchanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">هیچ تعویضی ثبت نشده است.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>سفارش</TableHead>
                      <TableHead>مشتری</TableHead>
                      <TableHead>از کالا</TableHead>
                      <TableHead>به کالا</TableHead>
                      <TableHead>تعداد</TableHead>
                      <TableHead>مابه‌التفاوت</TableHead>
                      <TableHead>حساب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exchanges.map((ex: any) => (
                      <TableRow key={ex.id}>
                        <TableCell>{formatJalaliDateTime(ex.createdAt)}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/sales/history/${ex.orderId}`} className="text-blue-600 hover:underline">
                            #{ex.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{ex.customerName}</TableCell>
                        <TableCell>{ex.originalProductName}</TableCell>
                        <TableCell>{ex.exchangeProductName}</TableCell>
                        <TableCell>{ex.quantity}</TableCell>
                        <TableCell>
                          {ex.priceDifference > 0 && (
                            <span className="text-green-600">+{ex.priceDifference.toLocaleString()}</span>
                          )}
                          {ex.priceDifference < 0 && (
                            <span className="text-red-600">{ex.priceDifference.toLocaleString()}</span>
                          )}
                          {ex.priceDifference === 0 && '—'}
                        </TableCell>
                        <TableCell>{ex.accountName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
