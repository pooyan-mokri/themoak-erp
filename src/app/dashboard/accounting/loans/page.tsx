import { getLoans } from '@/actions/loan';
import { getEmployees } from '@/actions/employee';
import { getAccounts } from '@/actions/accounting';
import { LoanForm } from '@/components/accounting/loan-form';
import { LoanList } from '@/components/accounting/loan-list';

export default async function LoansPage() {
  const loans = await getLoans();
  const employees = await getEmployees();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت قرض‌های کارمندان</h1>
      
      <div className="grid gap-6 md:grid-cols-2">
        <LoanForm employees={employees} />
        <LoanList loans={loans} accounts={accounts} />
      </div>
    </div>
  );
}

