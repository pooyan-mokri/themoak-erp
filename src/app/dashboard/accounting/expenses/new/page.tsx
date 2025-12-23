import { getAccounts } from '@/actions/accounting';
import { getProjects } from '@/actions/project';
import { getEmployees } from '@/actions/employee';
import { ExpenseForm } from '@/components/accounting/expense-form';

export default async function NewExpensePage() {
  const accounts = await getAccounts();
  const projects = await getProjects();
  const employees = await getEmployees();

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">ثبت هزینه جدید</h1>
      <ExpenseForm accounts={accounts} projects={projects} employees={employees} />
    </div>
  );
}
