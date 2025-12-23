'use client';

import { useState, useEffect } from 'react';
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
import { PayrollPaymentForm } from './payroll-payment-form';
import { DollarSign } from 'lucide-react';

interface Payroll {
  id: string;
  employee: {
    id: string;
    name: string;
  };
  amount: number;
  bonuses: number;
  deductions: number;
  netAmount: number;
  paidAmount: number;
  periodMonth: number;
  periodYear: number;
  status: string;
  payments: any[];
}

interface PayrollListProps {
  payrolls: Payroll[];
  accounts: any[];
}

export function PayrollList({ payrolls: initialPayrolls, accounts }: PayrollListProps) {
  const [payrolls, setPayrolls] = useState(initialPayrolls);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null);

  // Update payrolls when initialPayrolls prop changes
  useEffect(() => {
    setPayrolls(initialPayrolls);
  }, [initialPayrolls]);

  const handlePayment = (payroll: Payroll) => {
    setSelectedPayroll(payroll);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    setPaymentDialogOpen(false);
    setSelectedPayroll(null);
    window.location.reload();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="outline">در انتظار پرداخت</Badge>;
      case 'PARTIAL':
        return <Badge variant="default">پرداخت جزئی</Badge>;
      case 'PAID':
        return <Badge variant="outline" className="bg-green-100 text-green-800">پرداخت شده</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const remainingAmount = (payroll: Payroll) => payroll.netAmount - payroll.paidAmount;

  const monthNames = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>لیست فیش‌های حقوقی</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کارمند</TableHead>
                  <TableHead>دوره</TableHead>
                  <TableHead>مبلغ کل</TableHead>
                  <TableHead>پاداش</TableHead>
                  <TableHead>کسورات</TableHead>
                  <TableHead>خالص</TableHead>
                  <TableHead>پرداخت شده</TableHead>
                  <TableHead>باقیمانده</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="text-left">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrolls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      هیچ فیش حقوقی ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  payrolls.map((payroll) => (
                    <TableRow key={payroll.id}>
                      <TableCell className="font-medium">{payroll.employee.name}</TableCell>
                      <TableCell>
                        {payroll.periodYear}/{monthNames[payroll.periodMonth - 1]}
                      </TableCell>
                      <TableCell>{formatCurrency(payroll.amount)}</TableCell>
                      <TableCell>
                        <span className="text-green-600">{formatCurrency(payroll.bonuses || 0)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-red-600">{formatCurrency(payroll.deductions)}</span>
                      </TableCell>
                      <TableCell>{formatCurrency(payroll.netAmount)}</TableCell>
                      <TableCell>
                        <span className="text-green-600">{formatCurrency(payroll.paidAmount)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-orange-600 font-bold">
                          {formatCurrency(remainingAmount(payroll))}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(payroll.status)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePayment(payroll)}
                          disabled={payroll.status === 'PAID' || remainingAmount(payroll) <= 0}
                        >
                          <DollarSign className="h-4 w-4 ml-1" />
                          پرداخت
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

      {selectedPayroll && (
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                ثبت پرداخت حقوق - {selectedPayroll.employee.name} - {selectedPayroll.periodYear}/{monthNames[selectedPayroll.periodMonth - 1]}
              </DialogTitle>
            </DialogHeader>
            <PayrollPaymentForm
              payroll={selectedPayroll}
              accounts={accounts}
              onSuccess={handlePaymentSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

