'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PayDebtDialog } from './pay-debt-dialog';
import { HandCoins } from 'lucide-react';

interface Employee {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

interface Debt {
  employee: Employee;
  totalDebt: number;
  expenseCount: number;
  paymentCount: number;
}

interface Account {
  id: string;
  name: string;
  currency: string;
}

export function EmployeeDebtList({ debts, accounts }: { debts: Debt[], accounts: Account[] }) {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handlePayDebt = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedEmployee(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>لیست بدهی‌های کارمندان</CardTitle>
        </CardHeader>
        <CardContent>
          {debts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              هیچ بدهی ثبت نشده است.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کارمند</TableHead>
                  <TableHead>تلفن</TableHead>
                  <TableHead>تعداد هزینه‌ها</TableHead>
                  <TableHead>تعداد بازپرداخت‌ها</TableHead>
                  <TableHead>مبلغ بدهی</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debts.map((debt) => (
                  <TableRow key={debt.employee.id}>
                    <TableCell className="font-medium">{debt.employee.name}</TableCell>
                    <TableCell>{debt.employee.phone || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{debt.expenseCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{debt.paymentCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-bold text-red-600">
                        {debt.totalDebt.toLocaleString('fa-IR')} تومان
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePayDebt(debt.employee)}
                      >
                        <HandCoins className="w-4 h-4 ml-1" />
                        بازپرداخت
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedEmployee && (
        <PayDebtDialog
          employee={selectedEmployee}
          accounts={accounts}
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
        />
      )}
    </>
  );
}

