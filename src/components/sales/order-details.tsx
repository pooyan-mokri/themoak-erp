'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Order, Customer, OrderItem, Product, Transaction, Account } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowRight, Printer, RotateCcw, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDateTime } from '@/lib/date-utils';

import { InvoiceGenerator } from './invoice-generator';
import { ReturnItemDialog } from './return-item-dialog';
import { ExchangeItemDialog } from './exchange-item-dialog';

type OrderWithDetails = Order & {
  customer: Customer | null;
  items: (OrderItem & { product: Product; status?: string | null })[];
  transaction: (Transaction & { account: Account | null }) | null;
  invoice: any | null; // Using any for now to avoid type issues with outdated client
};

interface OrderDetailsProps {
  order: OrderWithDetails;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
  }>;
}

export function OrderDetails({ order, accounts }: OrderDetailsProps) {
  const router = useRouter();
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [exchangeDialogOpen, setExchangeDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<OrderDetailsProps['order']['items'][0] | null>(null);

  const handleReturnClick = (item: OrderDetailsProps['order']['items'][0]) => {
    setSelectedItem(item);
    setReturnDialogOpen(true);
  };

  const handleExchangeClick = (item: OrderDetailsProps['order']['items'][0]) => {
    setSelectedItem(item);
    setExchangeDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/sales/history">
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">سفارش #{order.number}</h1>
          <Badge variant={order.status === 'COMPLETED' ? 'default' : 'secondary'} className="mr-2">
            {order.status === 'COMPLETED' ? 'تکمیل شده' : order.status}
          </Badge>
        </div>
        <div className="flex gap-2">
          {order.invoice ? (
            <Link href={`/dashboard/sales/invoices/${order.invoice.id}`}>
              <Button variant="outline">
                مشاهده فاکتور
              </Button>
            </Link>
          ) : (
            <InvoiceGenerator orderId={order.id} />
          )}
          <Link href={`/dashboard/sales/orders/${order.id}/print`} target="_blank">
            <Button variant="outline">
              <Printer className="mr-2 h-4 w-4" />
              چاپ فاکتور
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>اقلام سفارش</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="h-12 w-12 bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
                        {item.product.image ? 'تصویر' : 'بدون تصویر'}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground">کد: {item.product.sku}</div>
                      </div>
                    </div>
                    <div className="text-left ml-4">
                      <div className="font-medium">{Number(item.price).toLocaleString()} تومان</div>
                      <div className="text-sm text-muted-foreground">x {item.quantity}</div>
                    </div>
                    <div className="flex gap-2 mr-4 items-center">
                      {(item.status || 'PENDING') === 'RETURNED' && (
                        <Badge variant="destructive" className="ml-2">عودت شده</Badge>
                      )}
                      {(item.status || 'PENDING') === 'EXCHANGED' && (
                        <Badge variant="secondary" className="ml-2">تعویض شده</Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReturnClick(item)}
                        disabled={(item.status || 'PENDING') === 'RETURNED' || (item.status || 'PENDING') === 'EXCHANGED'}
                      >
                        <RotateCcw className="w-4 h-4 ml-1" />
                        عودت
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExchangeClick(item)}
                        disabled={(item.status || 'PENDING') === 'RETURNED' || (item.status || 'PENDING') === 'EXCHANGED'}
                      >
                        <RefreshCw className="w-4 h-4 ml-1" />
                        تعویض
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <div className="flex justify-between items-center font-bold text-lg">
                <span>جمع کل</span>
                <span>{Number(order.totalAmount).toLocaleString()} تومان</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>اطلاعات مشتری</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">نام:</span>
                <span className="font-medium">{order.customer?.name || 'مشتری عمومی'}</span>
              </div>
              {order.customer?.phone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">تلفن:</span>
                  <span className="font-medium">{order.customer.phone}</span>
                </div>
              )}
              {order.customer?.address && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">آدرس:</span>
                  <span className="font-medium text-right max-w-[200px] truncate">{order.customer.address}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>اطلاعات پرداخت</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">تاریخ:</span>
                <span className="font-medium">{formatJalaliDateTime(order.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">روش پرداخت:</span>
                <span className="font-medium">
                    {order.transaction?.account?.name || 'نامشخص'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">شماره تراکنش:</span>
                <span className="font-medium text-xs font-mono">{order.transactionId?.slice(-8) || '-'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {selectedItem && (
        <>
          <ReturnItemDialog
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            orderId={order.id}
            orderItem={selectedItem}
            accounts={accounts}
            onSuccess={() => {
              router.refresh();
            }}
          />
          <ExchangeItemDialog
            open={exchangeDialogOpen}
            onOpenChange={setExchangeDialogOpen}
            orderId={order.id}
            originalItem={selectedItem}
            accounts={accounts}
            onSuccess={() => {
              router.refresh();
            }}
          />
        </>
      )}
    </div>
  );
}
