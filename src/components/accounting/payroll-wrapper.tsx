'use client';

import { useState, useCallback } from 'react';
import { PayrollForm } from './payroll-form';
import { PayrollList } from './payroll-list';
import { getPayrolls } from '@/actions/payroll';

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

interface PayrollWrapperProps {
  initialPayrolls: Payroll[];
  employees: any[];
  accounts: any[];
}

export function PayrollWrapper({ initialPayrolls, employees, accounts }: PayrollWrapperProps) {
  const [payrolls, setPayrolls] = useState(initialPayrolls);

  const handlePayrollCreated = useCallback(async () => {
    // Fetch updated payrolls list
    const updatedPayrolls = await getPayrolls();
    setPayrolls(updatedPayrolls);
  }, []);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <PayrollForm employees={employees} onSuccess={handlePayrollCreated} />
      <PayrollList payrolls={payrolls} accounts={accounts} />
    </div>
  );
}

