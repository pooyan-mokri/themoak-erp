
import { getAccounts } from '@/actions/accounting';
import { ExpenseForm } from '@/components/accounting/expense-form';
import { ExpenseList } from '@/components/accounting/expense-list';
import { prisma } from '@/lib/prisma';

async function getExpenses() {
  try {
    return await prisma.transaction.findMany({
      where: { 
        type: 'EXPENSE',
        // Exclude purchase-related expenses, payroll, and other non-expense transactions
        // Only show actual expenses (marketing, office, rent, etc.)
        NOT: {
          OR: [
            { purchasePayment: { isNot: null } },
            { PayrollPayment: { isNot: null } },
            { LoanPayment: { isNot: null } },
            { ShareholderWithdrawal: { isNot: null } },
          ]
        }
      },
      include: { 
        account: true,
        employee: true,
      },
      orderBy: { date: 'desc' },
      take: 100 // Increased limit for better filtering
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return [];
  }
}

export default async function ExpensesPage() {
  const accounts = await getAccounts();
  const expenses = await getExpenses();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت هزینه‌ها</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <ExpenseForm accounts={accounts} />
        <ExpenseList expenses={expenses} />
      </div>
    </div>
  );
}
