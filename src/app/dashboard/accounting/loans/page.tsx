import { getLoans } from '@/actions/loan';
import { getEmployees } from '@/actions/employee';
import { getAccounts } from '@/actions/accounting';
import { LoanList } from '@/components/accounting/loan-list';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/** قرض‌های کارمندان: خلاصه، نماها، پنل بازپرداخت‌ها؛ قرض جدید و ثبت بازپرداخت برای payroll.manage. */
export default async function LoansPage() {
  await requireRouteAccess('/dashboard/accounting/loans');
  const loans = await getLoans();
  const employees = await getEmployees();
  const accounts = await getAccounts();
  const canManage = await hasPermission('payroll.manage');

  return <LoanList loans={loans} accounts={accounts} employees={employees} canManage={canManage} />;
}
