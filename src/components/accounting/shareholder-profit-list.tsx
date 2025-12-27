'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShareholderWithdrawalForm } from './shareholder-withdrawal-form';
import { formatJalaliDate } from '@/lib/date-utils';
import { DollarSign } from 'lucide-react';

interface ShareholderProfit {
  id: string;
  shareholder: {
    id: string;
    name: string;
    percentage: number;
  };
  amount: number;
  withdrawn: number;
  available: number;
  description?: string;
  periodStart: Date;
  periodEnd: Date;
  withdrawals: any[];
}

interface ShareholderProfitListProps {
  profits: ShareholderProfit[];
  accounts: any[];
}

export function ShareholderProfitList({ profits: initialProfits, accounts }: ShareholderProfitListProps) {
  const [profits] = useState(initialProfits);
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [selectedProfit, setSelectedProfit] = useState<ShareholderProfit | undefined>(undefined);

  const handleWithdraw = (profit: ShareholderProfit) => {
    setSelectedProfit(profit);
    setWithdrawalDialogOpen(true);
  };

  const handleWithdrawalSuccess = () => {
    setWithdrawalDialogOpen(false);
    setSelectedProfit(null);
    window.location.reload();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>لیست سودهای قابل برداشت</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>صاحب سهام</TableHead>
                  <TableHead>مبلغ کل</TableHead>
                  <TableHead>برداشت شده</TableHead>
                  <TableHead>قابل برداشت</TableHead>
                  <TableHead>دوره</TableHead>
                  <TableHead className="text-left">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      هیچ سودی ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  profits.map((profit) => (
                    <TableRow key={profit.id}>
                      <TableCell className="font-medium">
                        {profit.shareholder.name} ({Number(profit.shareholder.percentage).toFixed(2)}%)
                      </TableCell>
                      <TableCell>{formatCurrency(profit.amount)}</TableCell>
                      <TableCell>
                        <span className="text-orange-600">{formatCurrency(profit.withdrawn)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-green-600 font-bold">
                          {formatCurrency(profit.available)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {formatJalaliDate(profit.periodStart)} - {formatJalaliDate(profit.periodEnd)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleWithdraw(profit)}
                          disabled={profit.available <= 0}
                        >
                          <DollarSign className="h-4 w-4 ml-1" />
                          برداشت
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedProfit && (
        <Dialog open={withdrawalDialogOpen} onOpenChange={setWithdrawalDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                برداشت سود - {selectedProfit.shareholder.name}
              </DialogTitle>
            </DialogHeader>
            <ShareholderWithdrawalForm
              profit={selectedProfit}
              accounts={accounts}
              onSuccess={handleWithdrawalSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

