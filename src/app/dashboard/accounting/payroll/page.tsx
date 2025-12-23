import { getPayrolls } from '@/actions/payroll';
import { getEmployees } from '@/actions/employee';
import { getAccounts } from '@/actions/accounting';
import { PayrollWrapper } from '@/components/accounting/payroll-wrapper';

export default async function PayrollPage() {
  const payrolls = await getPayrolls();
  const employees = await getEmployees();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت حقوق و دستمزد</h1>
      
      <PayrollWrapper initialPayrolls={payrolls} employees={employees} accounts={accounts} />
    </div>
  );
}

