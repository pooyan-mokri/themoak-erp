import { getEmployees } from '@/actions/employee';
import { EmployeesWrapper } from '@/components/accounting/employees-wrapper';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/** کارمندان: کارت هر نفر، جمع حقوق و میانگین سابقه، سالگردهای کاری؛ افزودن، ویرایش و حذف برای payroll.manage. */
export default async function EmployeesPage() {
  await requireRouteAccess('/dashboard/accounting/employees');
  const [employees, canManage] = await Promise.all([getEmployees(), hasPermission('payroll.manage')]);

  return <EmployeesWrapper initialEmployees={employees} canManage={canManage} />;
}
