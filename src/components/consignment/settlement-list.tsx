import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PaymentModal } from './payment-modal';
import { formatJalaliDate } from '@/lib/date-utils';

interface SettlementListProps {
  settlements: any[];
  accounts: any[];
}

export function SettlementList({ settlements, accounts }: SettlementListProps) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>تسویه‌های در انتظار پرداخت</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">همکار</TableHead>
              <TableHead className="text-right">تاریخ</TableHead>
              <TableHead className="text-right">اقلام</TableHead>
              <TableHead className="text-right">مبلغ کل (تومان)</TableHead>
              <TableHead className="text-right">وضعیت</TableHead>
              <TableHead className="text-right">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settlements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  هیچ تسویه‌ای در انتظار پرداخت نیست.
                </TableCell>
              </TableRow>
            ) : (
              settlements.map((settlement) => (
                <TableRow key={settlement.id}>
                  <TableCell className="font-medium">
                    {settlement.customer?.name || 'ناشناس'}
                  </TableCell>
                  <TableCell>
                    {formatJalaliDate(settlement.createdAt)}
                  </TableCell>
                  <TableCell>
                    {settlement.items.map((item: any) => (
                      <div key={item.id} className="text-sm">
                        {item.product.name} ({item.quantity} عدد)
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    {Number(settlement.totalAmount).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">در انتظار پرداخت</Badge>
                  </TableCell>
                  <TableCell>
                    <PaymentModal
                      orderId={settlement.id}
                      amount={Number(settlement.totalAmount)}
                      accounts={accounts}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
