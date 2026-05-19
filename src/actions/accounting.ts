'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// const prisma = new PrismaClient(); // Removed local instance

// --- Schemas ---

const AccountSchema = z.object({
  name: z.string().min(1, 'نام حساب الزامی است'),
  type: z.string().min(1, 'نوع حساب الزامی است'),
  currency: z.nativeEnum(Currency),
  initialBalance: z.coerce.number().optional(),
});

const ExpenseSchema = z.object({
  amount: z.coerce.number().min(1, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  category: z.string().min(1, 'دسته‌بندی الزامی است'), // For now just a string, later could be an Enum or Relation
  accountId: z.string().optional(), // Optional if employeeId is provided
  employeeId: z.string().optional(), // Optional if accountId is provided
  description: z.string().optional(),
  date: z.string().optional(), // ISO Date string
  projectId: z.string().optional(),
  receiptUrl: z.string().optional(),
}).refine((data) => data.accountId || data.employeeId, {
  message: 'باید حساب یا کارمند انتخاب شود',
  path: ['accountId'],
});

const ExchangeRateSchema = z.object({
  currency: z.nativeEnum(Currency),
  rateToToman: z.coerce.number().min(1, 'نرخ تبدیل باید معتبر باشد'),
});

// --- Actions ---

export async function createAccount(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = AccountSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    currency: formData.get('currency'),
    initialBalance: formData.get('initialBalance') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, type, currency, initialBalance } = validatedFields.data;

  try {
    await prisma.account.create({
      data: {
        name,
        type,
        currency,
        balance: initialBalance || 0,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ایجاد حساب.',
    };
  }

  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'حساب با موفقیت ایجاد شد.', success: true };
}

// Ensure Marketing Expenses account exists
async function ensureMarketingExpensesAccount() {
  try {
    const existingAccount = await prisma.account.findFirst({
      where: { name: 'Marketing Expenses' },
    });

    if (!existingAccount) {
      await prisma.account.create({
        data: {
          name: 'Marketing Expenses',
          type: 'EXPENSE',
          currency: 'TOMAN',
          balance: 0,
        },
      });
    }
  } catch (error) {
    console.error('Error ensuring Marketing Expenses account:', error);
  }
}

export async function getAccounts() {
  try {
    // Ensure Marketing Expenses account exists
    await ensureMarketingExpensesAccount();

    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Serialize Decimal fields
    return accounts.map((account: any) => ({
      ...account,
      balance: Number(account.balance),
    }));
  } catch (error) {
    console.error('Error fetching accounts:', error);
    throw new Error(`Failed to fetch accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function updateAccount(id: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  // Check if this is the Marketing Expenses account and prevent name change
  const existingAccount = await prisma.account.findUnique({
    where: { id },
    select: { name: true },
  });

  if (existingAccount?.name === 'Marketing Expenses') {
    const newName = formData.get('name')?.toString();
    if (newName && newName !== 'Marketing Expenses') {
      return {
        errors: { name: ['نام حساب "Marketing Expenses" قابل تغییر نیست.'] },
        message: 'نام حساب سیستم قابل تغییر نیست.',
      };
    }
  }
  const validatedFields = AccountSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    currency: formData.get('currency'),
    initialBalance: formData.get('initialBalance') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, type, currency, initialBalance } = validatedFields.data;

  try {
    await prisma.account.update({
      where: { id },
      data: {
        name,
        type,
        currency,
        balance: initialBalance !== undefined ? initialBalance : undefined,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ویرایش حساب.',
    };
  }

  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'حساب با موفقیت ویرایش شد.', success: true };
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  try {
    // Check if this is the Marketing Expenses account
    const account = await prisma.account.findUnique({
      where: { id },
      select: { name: true },
    });

    if (account?.name === 'Marketing Expenses') {
      return { success: false, message: 'حساب "Marketing Expenses" یک حساب سیستم است و قابل حذف نیست.' };
    }

    // Check for transactions
    const transactionCount = await prisma.transaction.count({
      where: { accountId: id },
    });

    if (transactionCount > 0) {
      return { success: false, message: 'این حساب دارای تراکنش است و قابل حذف نیست.' };
    }

    await prisma.account.delete({
      where: { id },
    });

    revalidatePath('/dashboard/accounting/accounts');
    return { success: true, message: 'حساب با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting account:', error);
    return { success: false, message: 'خطا در حذف حساب.' };
  }
}

export async function setExchangeRate(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ExchangeRateSchema.safeParse({
    currency: formData.get('currency'),
    rateToToman: formData.get('rateToToman'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { currency, rateToToman } = validatedFields.data;

  try {
    await prisma.exchangeRate.create({
      data: {
        currency,
        rateToToman,
        date: new Date(),
      },
    });
  } catch (error) {
    return { message: 'خطا در ثبت نرخ ارز.' };
  }

  revalidatePath('/dashboard/accounting/exchange-rates');
  return { message: 'نرخ ارز با موفقیت ثبت شد.' };
}

export async function getLatestExchangeRates() {
    // Logic to get the latest rate for each currency
    // For simplicity, fetching all and filtering in UI or complex query
    // A better approach is distinctOn in raw SQL or grouping, but let's keep it simple for now
    try {
        const rates = await prisma.exchangeRate.findMany({
            orderBy: { date: 'desc' },
            take: 100, // Limit to recent
        });

        // Serialize Decimal fields
        return rates.map((rate: any) => ({
            ...rate,
            rateToToman: Number(rate.rateToToman),
        }));
    } catch (error) {
        return [];
    }
}

export async function recordExpense(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const rawProjectId = formData.get('projectId');
  const projectIdValue = rawProjectId && rawProjectId !== 'none' ? rawProjectId : undefined;
  
  const rawAccountId = formData.get('accountId');
  const accountIdValue = rawAccountId && rawAccountId !== 'none' && rawAccountId !== '' ? rawAccountId : undefined;
  
  const rawEmployeeId = formData.get('employeeId');
  const employeeIdValue = rawEmployeeId && rawEmployeeId !== 'none' && rawEmployeeId !== '' ? rawEmployeeId : undefined;

  const validatedFields = ExpenseSchema.safeParse({
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    category: formData.get('category'),
    accountId: accountIdValue,
    employeeId: employeeIdValue,
    description: formData.get('description') || undefined,
    date: formData.get('date') || undefined,
    projectId: projectIdValue,
    receiptUrl: formData.get('receiptUrl') || undefined,
  });

  if (!validatedFields.success) {
    console.error('Validation errors:', validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { amount, currency, category, accountId, employeeId, description, date, projectId, receiptUrl } = validatedFields.data;

  try {
    // 1. Get Exchange Rate if not Toman
    let rate = 1;
    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency },
        orderBy: { date: 'desc' },
      });
      if (!latestRate) {
        return { message: `نرخ تبدیل برای ارز ${currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.` };
      }
      rate = Number(latestRate.rateToToman);
    }

    const amountInToman = amount * rate;

    // 2. Process expense based on payment source
    await prisma.$transaction(async (tx: any) => {
      if (employeeId) {
        // Expense paid by employee (Accounts Payable)
        // Verify employee exists
        const employee = await tx.employee.findUnique({
          where: { id: employeeId }
        });

        if (!employee) {
          throw new Error('کارمند یافت نشد');
        }

        // Create Transaction with employeeId (creates Accounts Payable)
        await tx.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(amountInToman),
            type: TransactionType.EXPENSE,
            // accountId is optional, omit it when null
            ...(accountId ? { accountId } : {}),
            employeeId: employeeId,
            category: category,
            description: description ? `${category} - ${description} (پرداخت شده توسط: ${employee.name})` : `${category} - پرداخت شده توسط: ${employee.name}`,
            date: date ? new Date(date) : new Date(),
            projectId: projectId || undefined,
            receiptUrl: receiptUrl || undefined,
          }
        });
        // No account balance update needed - this creates a payable (liability)
      } else if (accountId) {
        // Expense paid from company account
        // Check account exists and get balance
        const account = await tx.account.findUnique({
          where: { id: accountId }
        });

        if (!account) {
          throw new Error('حساب پرداخت یافت نشد');
        }

        // Check if account has sufficient balance
        const accountBalance = Number(account.balance);
        if (accountBalance < amountInToman) {
          throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} تومان، مبلغ مورد نیاز: ${amountInToman.toLocaleString('fa-IR')} تومان`);
        }

        // Create Transaction Record
        await tx.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(amountInToman),
            type: TransactionType.EXPENSE,
            accountId,
            category: category,
            description: description ? `${category} - ${description}` : category,
            date: date ? new Date(date) : new Date(),
            projectId: projectId || undefined,
            receiptUrl: receiptUrl || undefined,
          }
        });

        // Update Account Balance
        // Expenses decrease balance (use amountInToman since account balance is in Toman)
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: {
              decrement: new Prisma.Decimal(amountInToman)
            }
          }
        });
      } else {
        throw new Error('باید حساب یا کارمند انتخاب شود');
      }
    });

  } catch (error: unknown) {
    console.error('Error recording expense:', error);
    const errorObj = error as { message?: string; code?: string; meta?: unknown; stack?: string };
    console.error('Error details:', {
      message: errorObj.message,
      code: errorObj.code,
      meta: errorObj.meta,
      stack: errorObj.stack
    });

    // Return more specific error message if available
    if (errorObj.message) {
      return { message: `خطا در ثبت هزینه: ${errorObj.message}`, success: false };
    }

    return { message: 'خطا در ثبت هزینه.', success: false };
  }

  try {
    revalidatePath('/dashboard/accounting/expenses');
  } catch (error) {
    // Ignore revalidatePath error outside of Next.js context
  }
  return { message: 'هزینه با موفقیت ثبت شد.' };
}

export async function getSalesByProduct() {
  try {
    const orderItems = await prisma.orderItem.findMany({
      include: {
        product: true,
      },
    });

    const salesByProduct: Record<string, { name: string; quantity: number; total: number }> = {};

    for (const item of orderItems) {
      if (!salesByProduct[item.productId]) {
        salesByProduct[item.productId] = {
          name: item.product.name,
          quantity: 0,
          total: 0,
        };
      }
      salesByProduct[item.productId].quantity += item.quantity;
      salesByProduct[item.productId].total += Number(item.price) * item.quantity;
    }

    return Object.values(salesByProduct).sort((a: any, b: any) => b.total - a.total);
  } catch (error) {
    console.error('Error fetching sales by product:', error);
    return [];
  }
}

export async function getExpenseBreakdown() {
  try {
    const expenses = await prisma.transaction.findMany({
      where: {
        type: TransactionType.EXPENSE,
      },
    });

    const expenseByCategory: Record<string, number> = {};

    for (const expense of expenses) {
      // Extract category from description "Category - Description"
      const description = expense.description || 'Uncategorized';
      const parts = description.split(' - ');
      const category = parts.length > 0 ? parts[0] : 'Uncategorized';

      if (!expenseByCategory[category]) {
        expenseByCategory[category] = 0;
      }
      expenseByCategory[category] += Number(expense.amountInToman);
    }

    return Object.entries(expenseByCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a: any, b: any) => b.amount - a.amount);
  } catch (error) {
    console.error('Error fetching expense breakdown:', error);
    return [];
  }
}

/**
 * Get employee debts (Accounts Payable)
 * Returns list of employees with their total debt amounts
 */
export async function getEmployeeDebts() {
  try {
    // Get all employees
    const employees = await prisma.employee.findMany({
      orderBy: { name: 'asc' },
    });

    // Calculate debt for each employee
    const debtsWithDetails = await Promise.all(
      employees.map(async (employee: any) => {
        // Get all expense transactions (debts) for this employee
        const expenseTransactions = await prisma.transaction.findMany({
          where: {
            employeeId: employee.id,
            type: TransactionType.EXPENSE,
          },
        });

        // Get all income transactions (payments) for this employee
        const incomeTransactions = await prisma.transaction.findMany({
          where: {
            employeeId: employee.id,
            type: TransactionType.INCOME,
          },
        });

        // Calculate total debt (expenses - payments)
        const totalExpenses = expenseTransactions.reduce(
  (sum: any, tx: any) => sum + Number(tx.amountInToman),
          0
        );
        const totalPayments = incomeTransactions.reduce(
  (sum: any, tx: any) => sum + Number(tx.amountInToman),
          0
        );
        const totalDebt = totalExpenses - totalPayments;

        return {
          employee: {
            id: employee.id,
            name: employee.name,
            phone: employee.phone ?? undefined,
            email: employee.email ?? undefined,
          },
          totalDebt,
          expenseCount: expenseTransactions.length,
          paymentCount: incomeTransactions.length,
        };
      })
    );

    // Filter out employees with zero debt
    return debtsWithDetails.filter((debt: any) => debt.totalDebt > 0);
  } catch (error) {
    console.error('Error fetching employee debts:', error);
    return [];
  }
}

/**
 * Get detailed debt information for a specific employee
 */
export async function getEmployeeDebtDetails(employeeId: string) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return undefined;
    }

    // Get all expense transactions (debts)
    const expenseTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: employee.id,
        type: TransactionType.EXPENSE,
      },
      include: {
        project: true,
      },
      orderBy: { date: 'desc' },
    });

    // Get all income transactions (payments)
    const incomeTransactions = await prisma.transaction.findMany({
      where: {
        employeeId: employee.id,
        type: TransactionType.INCOME,
      },
      include: {
        account: true,
      },
      orderBy: { date: 'desc' },
    });

    const totalExpenses = expenseTransactions.reduce(
  (sum: any, tx: any) => sum + Number(tx.amountInToman),
      0
    );
    const totalPayments = incomeTransactions.reduce(
  (sum: any, tx: any) => sum + Number(tx.amountInToman),
      0
    );
    const totalDebt = totalExpenses - totalPayments;

    return {
      employee: {
        id: employee.id,
        name: employee.name,
        phone: employee.phone,
        email: employee.email,
      },
      totalDebt,
      totalExpenses,
      totalPayments,
      expenseTransactions: expenseTransactions.map((tx: any) => ({
        id: tx.id,
        amount: Number(tx.amountInToman),
        description: tx.description,
        date: tx.date,
        category: tx.category,
        project: tx.project?.name,
      })),
      paymentTransactions: incomeTransactions.map((tx: any) => ({
        id: tx.id,
        amount: Number(tx.amountInToman),
        description: tx.description,
        date: tx.date,
        account: tx.account?.name,
      })),
    };
  } catch (error) {
    console.error('Error fetching employee debt details:', error);
    return undefined;
  }
}

/**
 * Pay employee debt (record repayment)
 */
const PayDebtSchema = z.object({
  employeeId: z.string().min(1, 'کارمند الزامی است'),
  amount: z.coerce.number().min(1, 'مبلغ باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب پرداخت الزامی است'),
  description: z.string().optional(),
  date: z.string().optional(),
});

export async function payEmployeeDebt(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = PayDebtSchema.safeParse({
    employeeId: formData.get('employeeId'),
    amount: formData.get('amount'),
    accountId: formData.get('accountId'),
    description: formData.get('description') || undefined,
    date: formData.get('date') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { employeeId, amount, accountId, description, date } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // Verify employee exists
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
      });

      if (!employee) {
        throw new Error('کارمند یافت نشد');
      }

      // Verify account exists and has sufficient balance
      const account = await tx.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new Error('حساب یافت نشد');
      }

      const accountBalance = Number(account.balance);
      if (accountBalance < amount) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} تومان، مبلغ مورد نیاز: ${amount.toLocaleString('fa-IR')} تومان`);
      }

      // Create INCOME transaction (repayment to employee)
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amount),
          currency: 'TOMAN',
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: new Prisma.Decimal(amount),
          type: TransactionType.INCOME,
          accountId,
          employeeId,
          category: 'Employee Debt Payment',
          description: description || `بازپرداخت بدهی به ${employee.name}`,
          date: date ? new Date(date) : new Date(),
        },
      });

      // Decrease account balance (we're paying out money)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amount),
          },
        },
      });
    });

    revalidatePath('/dashboard/accounting/employee-debts');
    return {
      message: 'بازپرداخت بدهی با موفقیت ثبت شد.',
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error paying employee debt:', error);
    const message = error instanceof Error ? error.message : 'خطا در ثبت بازپرداخت بدهی.';
    return {
      message,
      success: false,
    };
  }
}

const DepositSchema = z.object({
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  accountId: z.string().min(1, 'حساب واریز الزامی است'),
  description: z.string().min(1, 'بابت چی الزامی است'),
  category: z.string().optional(),
  date: z.string().optional(),
});

export async function recordDeposit(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = DepositSchema.safeParse({
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    accountId: formData.get('accountId'),
    description: formData.get('description'),
    category: formData.get('category') || undefined,
    date: formData.get('date') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { amount, currency, accountId, description, category, date } = validatedFields.data;

  try {
    let rate = 1;
    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency },
        orderBy: { date: 'desc' },
      });
      if (!latestRate) {
        return { message: `نرخ تبدیل برای ارز ${currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.`, success: false };
      }
      rate = Number(latestRate.rateToToman);
    }

    const amountInToman = amount * rate;

    await prisma.$transaction(async (tx: any) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new Error('حساب یافت نشد');

      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amount),
          currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          type: TransactionType.INCOME,
          accountId,
          category: category || 'واریز',
          description,
          date: date ? new Date(date) : new Date(),
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: new Prisma.Decimal(amountInToman) } },
      });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در ثبت واریز.';
    return { message, success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/accounts');
  revalidatePath('/dashboard/accounting/deposits');
  return { message: 'واریز با موفقیت ثبت شد.', success: true };
}

export async function getTransactions() {
  try {
    const transactions = await prisma.transaction.findMany({
      orderBy: { date: 'desc' },
      include: {
        account: true,
        employee: true,
      },
      take: 100, // Limit to 100 most recent for now
    });
    
    // Get transaction IDs
    const transactionIds = transactions.map((t: any) => t.id);
    
    // Fetch all orders related to these transactions in one query
    const orders = await prisma.order.findMany({
      where: {
        transactionId: { in: transactionIds },
      },
      include: {
        customer: true,
      },
    });
    
    // Create a map of transactionId -> customer name
    const transactionIdToCustomerName = new Map<string, string>();
    orders.forEach((order: any) => {
      if (order.transactionId && order.customer) {
        transactionIdToCustomerName.set(order.transactionId, order.customer.name);
      }
    });
    
    // Replace customer ID with customer name in descriptions
    return transactions.map((transaction: any) => {
      // Check if description contains a customer ID pattern (cuid format)
      const customerIdPattern = /سفارش فروش - مشتری: ([a-z0-9]{20,})/;
      const match = transaction.description?.match(customerIdPattern);

      let description = transaction.description;
      if (match && transactionIdToCustomerName.has(transaction.id)) {
        const customerName = transactionIdToCustomerName.get(transaction.id)!;
        description = transaction.description?.replace(customerIdPattern, `سفارش فروش - مشتری: ${customerName}`) || transaction.description;
      }

      return {
        ...transaction,
        amount: Number(transaction.amount),
        amountInToman: Number(transaction.amountInToman),
        rateSnapshot: Number(transaction.rateSnapshot),
        description: description ?? undefined,
        category: transaction.category ?? undefined,
        accountId: transaction.accountId ?? undefined,
        projectId: transaction.projectId ?? undefined,
        employeeId: transaction.employeeId ?? undefined,
        shareholderId: transaction.shareholderId ?? undefined,
        receiptUrl: transaction.receiptUrl ?? undefined,
        wooId: transaction.wooId ?? undefined,
        wooStatus: transaction.wooStatus ?? undefined,
        account: transaction.account ? {
          ...transaction.account,
          balance: Number(transaction.account.balance),
        } : undefined,
        employee: transaction.employee ? {
          ...transaction.employee,
          salary: Number(transaction.employee.salary),
          userId: transaction.employee.userId ?? undefined,
          nationalId: transaction.employee.nationalId ?? undefined,
          phone: transaction.employee.phone ?? undefined,
          email: transaction.employee.email ?? undefined,
          address: transaction.employee.address ?? undefined,
          position: transaction.employee.position ?? undefined,
          hireDate: transaction.employee.hireDate ?? undefined,
        } : undefined,
      };
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}
