'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PayrollForm } from './payroll-form';
import { PayrollList, type Payroll } from './payroll-list';
import { getPayrolls } from '@/actions/payroll';

interface PayrollWrapperProps {
  initialPayrolls: Payroll[];
  employees: any[];
  accounts: any[];
  isAdmin?: boolean;
  /** May record payslips and pay them (payroll.manage); the server checks it again. */
  canManage?: boolean;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

export function PayrollWrapper({ initialPayrolls, employees, accounts, isAdmin = false, canManage = false }: PayrollWrapperProps) {
  const [payrolls, setPayrolls] = useState(initialPayrolls);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    // Fetch updated payrolls list
    const updatedPayrolls = await getPayrolls();
    setPayrolls(updatedPayrolls);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="حقوق و دستمزد"
        description={`${fa(payrolls.length)} فیش حقوقی · ${fa(employees.length)} کارمند`}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              فیش حقوقی جدید
            </Button>
          )
        }
      />

      <PayrollList
        payrolls={payrolls}
        accounts={accounts}
        isAdmin={isAdmin}
        canManage={canManage}
        employeeCount={employees.length}
        onNew={canManage ? () => setAdding(true) : undefined}
        onChanged={reload}
      />

      {canManage && (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ثبت فیش حقوقی جدید</DialogTitle>
            </DialogHeader>
            <PayrollForm
              employees={employees}
              onSuccess={async () => {
                setAdding(false);
                await reload();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
