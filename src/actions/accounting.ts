'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { balanceEffect, sumBalanceEffects, inAccountCurrency } from '@/lib/balance-reconciliation';

// const prisma = new PrismaClient(); // Removed local instance

/**
 * Repayments of an employee's out-of-pocket expenses. They are EXPENSE rows
 * (cash really leaves the account) and are identified by this category so the
 * debt report can net them against the employee's expenses.
 */
export const EMPLOYEE_DEBT_REPAYMENT_CATEGORY = 'تسویه بدهی کارمند';

// --- Schemas ---

const AccountSchema = z.object({
  name: z.string().min(1, 'نام حساب الزامی است'),
  type: z.string().min(1, 'نوع حساب الزامی است'),
  currency: z.nativeEnum(Currency),
  initialBalance: z.coerce.number().optional(),
  cardNumber: z.string().optional(),
  sheba: z.string().optional(),
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
    cardNumber: formData.get('cardNumber') || undefined,
    sheba: formData.get('sheba') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, type, currency, initialBalance, cardNumber, sheba } = validatedFields.data;

  try {
    await prisma.account.create({
      data: {
        name,
        type,
        currency,
        balance: initialBalance || 0,
        cardNumber: cardNumber || undefined,
        sheba: sheba || undefined,
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
    cardNumber: formData.get('cardNumber') || undefined,
    sheba: formData.get('sheba') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, type, currency, cardNumber, sheba } = validatedFields.data;

  try {
    await prisma.account.update({
      where: { id },
      data: {
        name,
        type,
        currency,
        // balance is deliberately NOT written here. It is a running total
        // maintained by increments/decrements that each pair with a
        // Transaction. Writing it from this form silently rebased the ledger
        // whenever the account was edited for any reason (e.g. to add a card
        // number), with no transaction to explain the jump. Use
        // adjustAccountBalance for a deliberate, auditable correction.
        cardNumber: cardNumber ?? null,
        sheba: sheba ?? null,
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

        // The money leaves the account in the account's own currency.
        const { amount: amountInAccountCurrency, rate: accountRate } =
          await inAccountCurrency(tx, account, amountInToman);

        // Check if account has sufficient balance
        const accountBalance = Number(account.balance);
        if (accountBalance < amountInAccountCurrency) {
          throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} ${account.currency}، مبلغ مورد نیاز: ${amountInAccountCurrency.toLocaleString('fa-IR')} ${account.currency}`);
        }

        // Create Transaction Record
        await tx.transaction.create({
          data: {
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(accountRate),
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

        // Update Account Balance in the account's own currency
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: {
              decrement: new Prisma.Decimal(amountInAccountCurrency)
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

// --- Admin-only: edit / delete a recorded expense ---

async function requireAdmin(): Promise<ActionResult | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.' };
  }
  return null;
}

/** Relations that mark an EXPENSE row as the accounting leg of another document. */
const SYSTEM_OWNED_RELATIONS = {
  marketingGift: { select: { id: true } },
  orderExchange: { select: { id: true } },
  orderReturn: { select: { id: true } },
  purchasePayment: { select: { id: true } },
  purchaseOrderPayment: { select: { id: true } },
  arrivalCosts: { select: { id: true } },
  LoanPayment: { select: { id: true } },
  PayrollPayment: { select: { id: true } },
  ShareholderWithdrawal: { select: { id: true } },
};

/**
 * Some EXPENSE rows are not standalone expenses — they are the accounting leg
 * of a consignment sale, a currency exchange, a return, a gift or a purchase
 * payment. Editing or deleting one from the expense list would move the
 * account balance and leave the document that created it untouched (deleting
 * one half of a currency exchange, for instance, credits the Toman account
 * without returning the dollars). Refuse, and name the module that owns it.
 */
function systemOwnerOf(expense: any): string | null {
  if (expense.orderReturn) return 'مرجوعی فروش';
  if (expense.orderExchange) return 'تعویض کالا';
  if (expense.marketingGift) return 'هدیه بازاریابی';
  if (expense.purchasePayment || expense.purchaseOrderPayment) return 'پرداخت سفارش خرید';
  if (expense.arrivalCosts?.length) return 'هزینه‌های ورود کالا';
  if (expense.LoanPayment) return 'پرداخت وام';
  if (expense.PayrollPayment) return 'پرداخت حقوق';
  if (expense.ShareholderWithdrawal) return 'برداشت سهامدار';
  if (expense.category === 'COGS') return 'بهای تمام‌شده کالای فروش امانی';
  if (expense.category === 'CONSIGNMENT_COMMISSION') return 'کمیسیون همکار امانی';
  if (expense.category === 'Currency Exchange') return 'مبادله ارز';
  return null;
}

/**
 * Delete an expense transaction (admin only).
 * Reverses the account balance change that was applied when the expense was recorded.
 */
export async function deleteExpense(id: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const expense = await prisma.transaction.findUnique({
      where: { id },
      include: SYSTEM_OWNED_RELATIONS,
    });
    if (!expense || expense.type !== TransactionType.EXPENSE) {
      return { success: false, message: 'هزینه یافت نشد.' };
    }

    const owner = systemOwnerOf(expense);
    if (owner) {
      return {
        success: false,
        message: `این سند به‌صورت خودکار توسط «${owner}» ثبت شده است و باید از همان بخش اصلاح یا لغو شود.`,
      };
    }

    await prisma.$transaction(async (tx: any) => {
      // Reverse the balance decrement for account-paid expenses.
      // Undo exactly what this row did to the balance, in the account's own
      // currency — balanceEffect replays the same rule the reconciliation
      // report uses, so the two can never disagree.
      if (expense.accountId) {
        await tx.account.update({
          where: { id: expense.accountId },
          data: { balance: { increment: new Prisma.Decimal(-balanceEffect(expense as any)) } },
        });
      }
      await tx.transaction.delete({ where: { id } });
    });

    revalidatePath('/dashboard/accounting/expenses');
    return { success: true, message: 'هزینه با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting expense:', error);
    return { success: false, message: 'خطا در حذف هزینه.' };
  }
}

const UpdateExpenseSchema = z.object({
  id: z.string().min(1),
  amount: z.coerce.number().min(1, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  category: z.string().min(1, 'دسته‌بندی الزامی است'),
  description: z.string().optional(),
  date: z.string().optional(),
  accountId: z.string().optional(),
});

/**
 * Edit an expense transaction (admin only).
 * Reverses the old account balance effect and applies the new one atomically.
 * Preserves the original payment mode: account-paid stays account-paid,
 * employee-paid (Accounts Payable) stays employee-paid with no balance change.
 */
export async function updateExpense(input: z.infer<typeof UpdateExpenseSchema>): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = UpdateExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: 'اطلاعات وارد شده معتبر نیست.' };
  }
  const { id, amount, currency, category, description, date, accountId } = parsed.data;

  try {
    const existing = await prisma.transaction.findUnique({
      where: { id },
      include: SYSTEM_OWNED_RELATIONS,
    });
    if (!existing || existing.type !== TransactionType.EXPENSE) {
      return { success: false, message: 'هزینه یافت نشد.' };
    }

    const owner = systemOwnerOf(existing);
    if (owner) {
      return {
        success: false,
        message: `این سند به‌صورت خودکار توسط «${owner}» ثبت شده است و باید از همان بخش اصلاح یا لغو شود.`,
      };
    }

    // Resolve new exchange rate / Toman amount
    let rate = 1;
    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency },
        orderBy: { date: 'desc' },
      });
      if (!latestRate) {
        return { success: false, message: `نرخ تبدیل برای ارز ${currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.` };
      }
      rate = Number(latestRate.rateToToman);
    }
    const newAmountInToman = amount * rate;
    const wasAccountPaid = !!existing.accountId;

    const result = await prisma.$transaction(async (tx: any) => {
      if (wasAccountPaid) {
        // 1. Reverse the original effect in the currency it was applied in
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { increment: new Prisma.Decimal(-balanceEffect(existing as any)) } },
        });

        // 2. Apply the new decrement (account may have changed)
        const targetAccountId = accountId || existing.accountId;
        const account = await tx.account.findUnique({ where: { id: targetAccountId } });
        if (!account) throw new Error('حساب پرداخت یافت نشد');

        const { amount: amountInAccountCurrency, rate: accountRate } =
          await inAccountCurrency(tx, account, newAmountInToman);

        if (Number(account.balance) < amountInAccountCurrency) {
          throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی فعلی: ${Number(account.balance).toLocaleString('fa-IR')} ${account.currency}`);
        }

        await tx.account.update({
          where: { id: targetAccountId },
          data: { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
        });

        await tx.transaction.update({
          where: { id },
          data: {
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(accountRate),
            amountInToman: new Prisma.Decimal(newAmountInToman),
            category,
            description: description || category,
            date: date ? new Date(date) : existing.date,
            accountId: targetAccountId,
          },
        });
      } else {
        // Employee-paid (liability) — no balance change
        await tx.transaction.update({
          where: { id },
          data: {
            amount: new Prisma.Decimal(amount),
            currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(newAmountInToman),
            category,
            description: description || category,
            date: date ? new Date(date) : existing.date,
          },
        });
      }
      return { ok: true };
    });

    if (!result.ok) return { success: false, message: 'خطا در ویرایش هزینه.' };

    revalidatePath('/dashboard/accounting/expenses');
    return { success: true, message: 'هزینه با موفقیت ویرایش شد.' };
  } catch (error: unknown) {
    console.error('Error updating expense:', error);
    const message = error instanceof Error ? error.message : 'خطا در ویرایش هزینه.';
    return { success: false, message };
  }
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
/**
 * Compare every account's stored balance against the balance re-derived from
 * its own transactions, so accounts whose ledger no longer adds up are visible.
 *
 * The difference is NOT purely error: it also contains the account's opening
 * balance, which was written directly at creation and has no transaction. The
 * UI says so — this report points at accounts worth checking, it does not
 * declare a number wrong on its own.
 */
export async function getAccountReconciliation() {
  try {
    // EXPENSE-type accounts hold no real money: COGS and commission stay at 0
    // by design (consignment.ts), so reconciling them only raises false alarms.
    const accounts = await prisma.account.findMany({
      where: { type: { not: 'EXPENSE' } },
      orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
      accounts.map(async (account: any) => {
        const transactions = await prisma.transaction.findMany({
          where: { accountId: account.id },
          select: { type: true, amount: true, description: true, date: true },
        });

        const computed = sumBalanceEffects(transactions as any);
        const stored = Number(account.balance);

        return {
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          stored,
          computed,
          difference: stored - computed,
          transactionCount: transactions.length,
          lastTransactionAt:
            transactions.length > 0
              ? transactions.reduce(
                  (latest: Date, t: any) => (t.date > latest ? t.date : latest),
                  transactions[0].date as Date,
                )
              : null,
        };
      }),
    );

    return rows;
  } catch (error) {
    console.error('Error building account reconciliation:', error);
    return [];
  }
}

/**
 * Deliberately correct an account's balance to a known figure (e.g. a bank
 * statement), writing an ADJUSTMENT transaction for the difference so the
 * change is explained and the ledger invariant
 * (balance == opening + Σ transactions) still holds.
 *
 * This replaces the old behaviour where saving the account edit form silently
 * overwrote the balance with no record of what changed or why.
 */
export async function adjustAccountBalance(input: {
  accountId: string;
  targetBalance: number;
  note?: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند موجودی را اصلاح کند.' };
  }

  const { accountId, targetBalance, note } = input;
  if (!Number.isFinite(targetBalance)) {
    return { success: false, message: 'موجودی جدید معتبر نیست.' };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new Error('حساب یافت نشد.');

      const current = Number(account.balance);
      const delta = targetBalance - current;
      if (Math.abs(delta) < 0.5) return { delta: 0, name: account.name };

      await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          // Signed on purpose: an ADJUSTMENT carries no implicit direction, so
          // reconciliation can only re-derive its effect if the sign is stored.
          amount: new Prisma.Decimal(delta),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: new Prisma.Decimal(delta),
          accountId,
          category: 'اصلاح موجودی',
          description:
            (note?.trim() ? `${note.trim()} — ` : '') +
            `اصلاح موجودی از ${Math.round(current).toLocaleString('fa-IR')} به ${Math.round(targetBalance).toLocaleString('fa-IR')}`,
          date: new Date(),
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { balance: new Prisma.Decimal(targetBalance) },
      });

      return { delta, name: account.name };
    });

    revalidatePath('/dashboard', 'layout');

    return result.delta === 0
      ? { success: true, message: 'موجودی از قبل درست بود؛ تغییری ثبت نشد.' }
      : {
          success: true,
          message: `موجودی «${result.name}» اصلاح شد (${result.delta > 0 ? '+' : ''}${Math.round(result.delta).toLocaleString('fa-IR')}) و سند اصلاح ثبت گردید.`,
        };
  } catch (error) {
    console.error('Error adjusting account balance:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در اصلاح موجودی.',
    };
  }
}

export async function getEmployeeDebts() {
  try {
    // Get all employees
    const employees = await prisma.employee.findMany({
      orderBy: { name: 'asc' },
    });

    // Calculate debt for each employee
    const debtsWithDetails = await Promise.all(
      employees.map(async (employee: any) => {
        // Repayments are identified by category, not by INCOME/EXPENSE:
        // they are EXPENSE rows now, and legacy rows are INCOME.
        const allTransactions = await prisma.transaction.findMany({
          where: { employeeId: employee.id },
        });
        const isRepayment = (tx: any) =>
          tx.category === EMPLOYEE_DEBT_REPAYMENT_CATEGORY ||
          tx.type === TransactionType.INCOME;

        const expenseTransactions = allTransactions.filter(
          (tx: any) => tx.type === TransactionType.EXPENSE && !isRepayment(tx),
        );
        const incomeTransactions = allTransactions.filter(isRepayment);

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

    // Repayments are identified by category (EXPENSE rows now, legacy INCOME).
    const allEmployeeTransactions = await prisma.transaction.findMany({
      where: { employeeId: employee.id },
      include: { project: true, account: true },
      orderBy: { date: 'desc' },
    });
    const isRepayment = (tx: any) =>
      tx.category === EMPLOYEE_DEBT_REPAYMENT_CATEGORY ||
      tx.type === TransactionType.INCOME;

    const expenseTransactions = allEmployeeTransactions.filter(
      (tx: any) => tx.type === TransactionType.EXPENSE && !isRepayment(tx),
    );
    const incomeTransactions = allEmployeeTransactions.filter(isRepayment);

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

      // Money leaves the account, so the row must be an EXPENSE. It was typed
      // INCOME purely so the debt report could net it out, which made every
      // repayment of X drive the stored balance 2X away from the sum of its
      // transactions. The debt report now nets by category instead.
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amount),
          currency: 'TOMAN',
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: new Prisma.Decimal(amount),
          type: TransactionType.EXPENSE,
          accountId,
          employeeId,
          category: EMPLOYEE_DEBT_REPAYMENT_CATEGORY,
          description: description || `تسویه بدهی به ${employee.name}`,
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

// ─── Withdrawal ───────────────────────────────────────────────────────────────

const WithdrawalSchema = z.object({
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  accountId: z.string().min(1, 'حساب مبدأ الزامی است'),
  payee: z.string().min(1, 'نام گیرنده الزامی است'),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  date: z.string().optional(),
  receiptUrl: z.string().optional(),
});

export async function recordWithdrawal(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = WithdrawalSchema.safeParse({
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    accountId: formData.get('accountId'),
    payee: formData.get('payee'),
    description: formData.get('description') || undefined,
    category: formData.get('category') || undefined,
    tags: formData.get('tags') || undefined,
    date: formData.get('date') || undefined,
    receiptUrl: formData.get('receiptUrl') || undefined,
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors, message: 'لطفا فیلدهای الزامی را پر کنید.', success: false };
  }

  const { amount, currency, accountId, payee, description, category, tags, date, receiptUrl } = validatedFields.data;

  try {
    let rate = 1;
    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({ where: { currency }, orderBy: { date: 'desc' } });
      if (!latestRate) return { message: `نرخ تبدیل برای ارز ${currency} یافت نشد.`, success: false };
      rate = Number(latestRate.rateToToman);
    }
    const amountInToman = amount * rate;
    const tagsArr = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

    await prisma.$transaction(async (tx: any) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new Error('حساب یافت نشد');
      // The money leaves the account in the account's own currency.
      const { amount: amountInAccountCurrency, rate: accountRate } =
        await inAccountCurrency(tx, account, amountInToman);
      if (Number(account.balance) < amountInAccountCurrency) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست.`);
      }
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amountInAccountCurrency),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(accountRate),
          amountInToman: new Prisma.Decimal(amountInToman),
          type: TransactionType.EXPENSE,
          accountId,
          payee,
          category: category || 'برداشت/پرداخت',
          description: description || `پرداخت به: ${payee}`,
          tags: tagsArr,
          date: date ? new Date(date) : new Date(),
          receiptUrl: receiptUrl || undefined,
        },
      });
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
      });
    });
  } catch (error: unknown) {
    return { message: error instanceof Error ? error.message : 'خطا در ثبت برداشت.', success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'پرداخت با موفقیت ثبت شد.', success: true };
}

// ─── Internal Transfer ────────────────────────────────────────────────────────

const TransferSchema = z.object({
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  fromAccountId: z.string().min(1, 'حساب مبدأ الزامی است'),
  toAccountId: z.string().min(1, 'حساب مقصد الزامی است'),
  description: z.string().optional(),
  tags: z.string().optional(),
  date: z.string().optional(),
  receiptUrl: z.string().optional(),
});

export async function recordInternalTransfer(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = TransferSchema.safeParse({
    amount: formData.get('amount'),
    fromAccountId: formData.get('fromAccountId'),
    toAccountId: formData.get('toAccountId'),
    description: formData.get('description') || undefined,
    tags: formData.get('tags') || undefined,
    date: formData.get('date') || undefined,
    receiptUrl: formData.get('receiptUrl') || undefined,
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors, message: 'لطفا فیلدهای الزامی را پر کنید.', success: false };
  }

  const { amount, fromAccountId, toAccountId, description, tags, date, receiptUrl } = validatedFields.data;

  if (fromAccountId === toAccountId) {
    return { message: 'حساب مبدأ و مقصد نمی‌توانند یکسان باشند.', success: false };
  }

  try {
    const [fromAccount, toAccount] = await Promise.all([
      prisma.account.findUnique({ where: { id: fromAccountId } }),
      prisma.account.findUnique({ where: { id: toAccountId } }),
    ]);

    if (!fromAccount || !toAccount) return { message: 'حساب یافت نشد.', success: false };
    if (fromAccount.currency !== toAccount.currency) {
      return { message: `ارز دو حساب باید یکسان باشد (${fromAccount.currency} ≠ ${toAccount.currency}). برای تبدیل ارز از بخش "خرید و فروش ارز" استفاده کنید.`, success: false };
    }
    if (Number(fromAccount.balance) < amount) {
      return { message: `موجودی حساب "${fromAccount.name}" کافی نیست.`, success: false };
    }

    const tagsArr = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const txDate = date ? new Date(date) : new Date();
    const desc = description || `انتقال از ${fromAccount.name} به ${toAccount.name}`;

    await prisma.$transaction(async (tx: any) => {
      // Debit source
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amount),
          currency: fromAccount.currency,
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: new Prisma.Decimal(amount),
          type: TransactionType.TRANSFER,
          accountId: fromAccountId,
          category: 'انتقال وجه',
          description: `[خروج] ${desc}`,
          tags: tagsArr,
          date: txDate,
          receiptUrl: receiptUrl || undefined,
        },
      });
      // Credit destination
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amount),
          currency: toAccount.currency,
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: new Prisma.Decimal(amount),
          type: TransactionType.TRANSFER,
          accountId: toAccountId,
          category: 'انتقال وجه',
          description: `[ورود] ${desc}`,
          tags: tagsArr,
          date: txDate,
          receiptUrl: receiptUrl || undefined,
        },
      });
      await tx.account.update({ where: { id: fromAccountId }, data: { balance: { decrement: new Prisma.Decimal(amount) } } });
      await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: new Prisma.Decimal(amount) } } });
    });
  } catch (error: unknown) {
    return { message: error instanceof Error ? error.message : 'خطا در انتقال وجه.', success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'انتقال وجه با موفقیت ثبت شد.', success: true };
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

const DepositSchema = z.object({
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  accountId: z.string().min(1, 'حساب واریز الزامی است'),
  description: z.string().min(1, 'بابت چی الزامی است'),
  category: z.string().optional(),
  tags: z.string().optional(),
  date: z.string().optional(),
});

export async function recordDeposit(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = DepositSchema.safeParse({
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    accountId: formData.get('accountId'),
    description: formData.get('description'),
    category: formData.get('category') || undefined,
    tags: formData.get('tags') || undefined,
    date: formData.get('date') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { amount, currency, accountId, description, category, tags, date } = validatedFields.data;
  const tagsArr = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

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

      // The money lands in the account in the account's own currency.
      const { amount: amountInAccountCurrency, rate: accountRate } =
        await inAccountCurrency(tx, account, amountInToman);

      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amountInAccountCurrency),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(accountRate),
          amountInToman: new Prisma.Decimal(amountInToman),
          type: TransactionType.INCOME,
          accountId,
          category: category || 'واریز',
          description,
          tags: tagsArr,
          date: date ? new Date(date) : new Date(),
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: new Prisma.Decimal(amountInAccountCurrency) } },
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
