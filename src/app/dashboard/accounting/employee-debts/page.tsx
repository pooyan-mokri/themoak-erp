import { getEmployeeDebts, getAccounts } from '@/actions/accounting';
import { EmployeeDebtList } from '@/components/accounting/employee-debt-list';
import { PayDebtDialog } from '@/components/accounting/pay-debt-dialog';

export default async function EmployeeDebtsPage() {
  const debts = await getEmployeeDebts();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">بدهی کارمندان (Accounts Payable)</h1>
      </div>
      <EmployeeDebtList debts={debts} accounts={accounts} />
    </div>
  );
}

