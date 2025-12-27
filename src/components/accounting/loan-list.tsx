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
import { LoanPaymentForm } from './loan-payment-form';
import { formatJalaliDate } from '@/lib/date-utils';
import { DollarSign, Eye } from 'lucide-react';

interface Loan {
  id: string;
  employee: {
    id: string;
    name: string;
  };
  amount: number;
  remaining: number;
  interestRate: number;
  description?: string;
  dueDate?: Date;
  status: string;
  payments: any[];
}

interface LoanListProps {
  loans: Loan[];
  accounts: any[];
}

export function LoanList({ loans: initialLoans, accounts }: LoanListProps) {
  const [loans] = useState(initialLoans);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | undefined>(undefined);

  const handlePayment = (loan: Loan) => {
    setSelectedLoan(loan);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    setPaymentDialogOpen(false);
    setSelectedLoan(null);
    window.location.reload();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default">فعال</Badge>;
      case 'PAID':
        return <Badge variant="outline" className="bg-green-100 text-green-800">پرداخت شده</Badge>;
      case 'DEFAULTED':
        return <Badge variant="destructive">پیش فرض</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const paidAmount = (loan: Loan) => loan.amount - loan.remaining;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>لیست قرض‌ها</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>گیرنده</TableHead>
                  <TableHead>مبلغ کل</TableHead>
                  <TableHead>پرداخت شده</TableHead>
                  <TableHead>باقیمانده</TableHead>
                  <TableHead>نرخ بهره</TableHead>
                  <TableHead>تاریخ سررسید</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="text-left">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      هیچ قرضی ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  loans.map((loan) => (
                    <TableRow key={loan.id}>
                      <TableCell className="font-medium">{loan.employee.name}</TableCell>
                      <TableCell>{formatCurrency(loan.amount)}</TableCell>
                      <TableCell>
                        <span className="text-green-600">{formatCurrency(paidAmount(loan))}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-orange-600 font-bold">
                          {formatCurrency(loan.remaining)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {loan.interestRate > 0 ? `${loan.interestRate.toFixed(2)}%` : '-'}
                      </TableCell>
                      <TableCell>
                        {loan.dueDate ? formatJalaliDate(loan.dueDate) : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(loan.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePayment(loan)}
                            disabled={loan.status === 'PAID' || loan.remaining <= 0}
                          >
                            <DollarSign className="h-4 w-4 ml-1" />
                            پرداخت
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedLoan && (
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                ثبت بازپرداخت - {selectedLoan.employee.name}
              </DialogTitle>
            </DialogHeader>
            <LoanPaymentForm
              loan={selectedLoan}
              accounts={accounts}
              onSuccess={handlePaymentSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

