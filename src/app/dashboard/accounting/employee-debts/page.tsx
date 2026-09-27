import { getEmployeeDebts, getAccounts } from '@/actions/accounting';
import { getLoans } from '@/actions/loan';
import { EmployeeDebtList } from '@/components/accounting/employee-debt-list';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/**
 * بدهی کارمندان: هزینه‌هایی که کارمند پرداخته و شرکت بدهکار است، در کنار مانده
 * قرض‌ها برای عدد خالص؛ ردیف‌های هر کارمند در پنل کنار؛ بازپرداخت برای payroll.manage.
 */
export default async function EmployeeDebtsPage() {
  await requireRouteAccess('/dashboard/accounting/employee-debts');
  const debts = await getEmployeeDebts();
  const accounts = await getAccounts();
  const loans = await getLoans();
  const canManage = await hasPermission('payroll.manage');

  // Only the loans' totals travel to the page: what employees still owe on them.
  const open = loans.filter((loan: any) => loan.status !== 'PAID' && loan.remaining > 0);
  const outstanding = open.reduce((sum: number, loan: any) => sum + loan.remaining, 0);

  return (
    <EmployeeDebtList
      debts={debts}
      accounts={accounts}
      canManage={canManage}
      loans={{ outstanding, count: open.length }}
    />
  );
}
