import { getPayrolls } from '@/actions/payroll';
import { getEmployees } from '@/actions/employee';
import { getAccounts } from '@/actions/accounting';
import { PayrollWrapper } from '@/components/accounting/payroll-wrapper';
import { getCurrentRole, hasPermission, requireRouteAccess } from '@/lib/access';

/** حقوق و دستمزد: دوره فعلی، دوره‌های اخیر و فیش‌ها؛ ثبت و پرداخت برای payroll.manage، ویرایش فیش فقط برای مدیر. */
export default async function PayrollPage() {
  await requireRouteAccess('/dashboard/accounting/payroll');
  const payrolls = await getPayrolls();
  const employees = await getEmployees();
  const accounts = await getAccounts();
  const isAdmin = (await getCurrentRole()) === 'ADMIN';
  const canManage = await hasPermission('payroll.manage');

  return (
    <PayrollWrapper initialPayrolls={payrolls} employees={employees} accounts={accounts} isAdmin={isAdmin} canManage={canManage} />
  );
}
