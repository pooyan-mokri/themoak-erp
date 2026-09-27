import { getAccounts, getTransactions } from '@/actions/accounting';
import { getProjects } from '@/actions/project';
import { getEmployees } from '@/actions/employee';
import { ExpenseForm } from '@/components/accounting/expense-form';
import { MoneyFormSwitch } from '@/components/accounting/entry-parts';
import { recentExpenses, recentFrom } from '@/components/accounting/recent-entries';
import { PageHeader } from '@/components/layout/page-header';
import { requireRouteAccess } from '@/lib/access';

export default async function NewExpensePage() {
  await requireRouteAccess('/dashboard/accounting');
  const [accounts, projects, employees, rows] = await Promise.all([
    getAccounts(),
    getProjects(),
    getEmployees(),
    getTransactions({ from: recentFrom() }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="هزینه جدید"
        description="هزینه‌های جاری و پروژه‌ای، پرداخت‌شده از حساب شرکت یا از جیب یک کارمند."
        actions={<MoneyFormSwitch current="expense" />}
      />
      <ExpenseForm accounts={accounts} projects={projects} employees={employees} recent={recentExpenses(rows)} />
    </div>
  );
}
