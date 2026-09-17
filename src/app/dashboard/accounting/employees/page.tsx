import { getEmployees } from '@/actions/employee';
import { EmployeesWrapper } from '@/components/accounting/employees-wrapper';
import { requireRouteAccess } from '@/lib/access';

export default async function EmployeesPage() {
  await requireRouteAccess('/dashboard/accounting/employees');
  const employees = await getEmployees();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت کارمندان</h1>
      
      <EmployeesWrapper initialEmployees={employees} />
    </div>
  );
}

