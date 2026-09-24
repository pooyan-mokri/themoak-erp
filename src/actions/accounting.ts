'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { checkPermission, getCurrentRole, hasPermission, requirePermission } from '@/lib/access';
import { auth } from '@/auth';
import { balanceEffect, sumBalanceEffects, inAccountCurrency } from '@/lib/balance-reconciliation';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { INVALID_RECEIPT_MESSAGE, readReceiptRef } from '@/lib/receipt-ref';
import { JOURNAL_MAX_ROWS } from '@/lib/journal-export';
import { randomUUID } from 'node:crypto';

// const prisma = new PrismaClient(); // Removed local instance

/**
 * Repayments of an employee's out-of-pocket expenses. They are EXPENSE rows
 * (cash really leaves the account) and are identified by this category so the
 * debt report can net them against the employee's expenses.
 */
// Not exported: a "use server" file may only export async functions, and
// exporting this constant failed every Next.js build.
const EMPLOYEE_DEBT_REPAYMENT_CATEGORY = 'تسویه بدهی کارمند';

/** The one ADJUSTMENT row that documents an account's historical difference and moves no money. */
const BASELINE_CATEGORY = 'مانده پایه';

/**
 * COGS and gift rows are valued at product cost, so their amounts are cost
 * data (cost.view), which an accountant reading the journal may not see.
 * Consignment books COGS as 'COGS'; a gift from the marketing module is
 * 'Marketing - Gift' and linked from its MarketingGift; a gift from the
 * product page is 'Marketing/Gift'.
 */
const COST_CATEGORIES = ['COGS', 'Marketing - Gift', 'Marketing/Gift'];

function isCostRow(transaction: { category?: string | null; marketingGift?: unknown }): boolean {
  return COST_CATEGORIES.includes(transaction.category ?? '') || !!transaction.marketingGift;
}

/**
 * True when this submission's id is already stored, i.e. it was booked before
 * (src/lib/request-id.ts). Checked first, so a repeat answers as the first one
 * did even when the balance no longer covers it; the unique column still
 * catches two copies that arrive at the same moment.
 */
async function alreadyBooked(requestId: string | null): Promise<boolean> {
  if (!requestId) return false;
  return !!(await prisma.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }));
}

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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
    await prisma.$transaction(async (tx: any) => {
      const account = await tx.account.create({
        data: {
          name,
          type,
          currency,
          balance: initialBalance || 0,
          cardNumber: cardNumber || undefined,
          sheba: sheba || undefined,
        },
      });
      // The opening balance is a row like any other money, so the
      // reconciliation of a new account starts at a difference of 0.
      if (initialBalance) {
        await tx.transaction.create({
          data: {
            type: TransactionType.ADJUSTMENT,
            amount: new Prisma.Decimal(initialBalance),
            currency,
            rateSnapshot: new Prisma.Decimal(1),
            amountInToman: new Prisma.Decimal(initialBalance),
            accountId: account.id,
            category: 'موجودی اولیه',
            description: 'موجودی اولیه',
            date: new Date(),
          },
        });
      }
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
  await requirePermission('finance.view');
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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

  // Check if this is the Marketing Expenses account and prevent name change
  const existingAccount = await prisma.account.findUnique({
    where: { id },
    select: { name: true, type: true, currency: true },
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

  // EXPENSE accounts are P&L buckets, not money, and money totals and payment
  // pickers decide inclusion by type — so the type must not cross that line in
  // either direction. The edit form has no EXPENSE option, so saving one of
  // these accounts used to quietly resubmit it as BANK.
  const wasExpense = existingAccount?.type === 'EXPENSE';
  if (wasExpense !== (type === 'EXPENSE')) {
    const message = wasExpense
      ? 'نوع حساب‌های هزینه‌ای سیستم (مثل بهای تمام‌شده) قابل تغییر نیست.'
      : 'نمی‌توان حساب را به حساب هزینه‌ای تبدیل کرد.';
    return { errors: { type: [message] }, message };
  }

  // An account's rows are amounts in its own currency (balanceEffect reads them
  // that way), so relabelling the currency would silently revalue its history.
  if (existingAccount && currency !== existingAccount.currency) {
    const rows = await prisma.transaction.count({ where: { accountId: id } });
    if (rows > 0) {
      const message = `ارز حسابی که تراکنش دارد قابل تغییر نیست (${existingAccount.currency}). برای ارز دیگر یک حساب جدید بسازید.`;
      return { errors: { currency: [message] }, message };
    }
  }

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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
    // Rates carry no balance; the supplier order pages read them too.
    if (!(await hasPermission(['finance.view', 'stock.view']))) return [];
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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
  const requestId = readRequestId(formData.get('requestId'));

  try {
    if (await alreadyBooked(requestId)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

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
            clientRequestId: requestId ?? undefined,
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
            clientRequestId: requestId ?? undefined,
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
    // The same submission a second time: it was booked once, by the first.
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
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
  return { message: 'هزینه با موفقیت ثبت شد.', success: true };
}

// --- Edit / delete a recorded expense (finance.manage) ---

// --- Admin-only: edit / delete a recorded expense, correct a balance ---

async function requireAdmin(): Promise<ActionResult | null> {
  if ((await getCurrentRole()) !== 'ADMIN') {
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
  siteRefund: { select: { id: true } },
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
  if (expense.siteRefund) return 'بازپرداخت سفارش سایت';
  if (expense.marketingGift) return 'هدیه بازاریابی';
  if (expense.purchasePayment || expense.purchaseOrderPayment) return 'پرداخت سفارش خرید';
  if (expense.arrivalCosts?.length) return 'هزینه‌های ورود کالا';
  if (expense.LoanPayment) return 'پرداخت وام';
  if (expense.PayrollPayment) return 'پرداخت حقوق';
  if (expense.ShareholderWithdrawal) return 'برداشت سهامدار';
  if (expense.category === 'COGS') return 'بهای تمام‌شده کالای فروش امانی';
  if (expense.category === 'CONSIGNMENT_COMMISSION') return 'کمیسیون همکار امانی';
  if (expense.category === 'Currency Exchange') return 'مبادله ارز';
  // Money of an order (a refund recorded on the website review page, a settlement cost):
  // changed only from the order's own screens, which keep the order in step.
  if (expense.orderId) return 'پول یک سفارش';
  return null;
}

/** A refusal meant for the user, not a crash. */
class ExpenseRefusal extends Error {}

/**
 * Delete an expense transaction (finance.manage).
 * Reverses the account balance change that was applied when the expense was recorded.
 */
export async function deleteExpense(id: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    await prisma.$transaction(async (tx: any) => {
      // Read the expense inside the transaction, with its row locked, as
      // updateExpense does: an edit of it waits, or is waited for, and the
      // reversal below undoes what the row holds now, not what it held before.
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${id} FOR UPDATE`;
      const expense = await tx.transaction.findUnique({
        where: { id },
        include: SYSTEM_OWNED_RELATIONS,
      });
      if (!expense || expense.type !== TransactionType.EXPENSE) {
        throw new ExpenseRefusal('هزینه یافت نشد.');
      }

      const owner = systemOwnerOf(expense);
      if (owner) {
        throw new ExpenseRefusal(`این سند به‌صورت خودکار توسط «${owner}» ثبت شده است و باید از همان بخش اصلاح یا لغو شود.`);
      }

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
    if (error instanceof ExpenseRefusal) return { success: false, message: error.message };
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
 * Edit an expense transaction (finance.manage).
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
    const result = await prisma.$transaction(async (tx: any) => {
      // Read the expense inside the transaction, with its row locked: a second
      // edit or a delete of it waits, and this one reverses what the row holds
      // now, not what it held before the other one changed it.
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.transaction.findUnique({
        where: { id },
        include: SYSTEM_OWNED_RELATIONS,
      });
      if (!existing || existing.type !== TransactionType.EXPENSE) {
        throw new Error('هزینه یافت نشد.');
      }

      const owner = systemOwnerOf(existing);
      if (owner) {
        throw new Error(`این سند به‌صورت خودکار توسط «${owner}» ثبت شده است و باید از همان بخش اصلاح یا لغو شود.`);
      }

      // Resolve new exchange rate / Toman amount
      let rate = 1;
      if (currency !== 'TOMAN') {
        const latestRate = await tx.exchangeRate.findFirst({
          where: { currency },
          orderBy: { date: 'desc' },
        });
        if (!latestRate) {
          throw new Error(`نرخ تبدیل برای ارز ${currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.`);
        }
        rate = Number(latestRate.rateToToman);
      }
      const newAmountInToman = amount * rate;
      const wasAccountPaid = !!existing.accountId;

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
  await requirePermission('sales.view');
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
  await requirePermission('finance.view');
  try {
    const canSeeCost = await hasPermission('cost.view');
    const expenses = await prisma.transaction.findMany({
      where: {
        type: TransactionType.EXPENSE,
      },
      include: { marketingGift: { select: { id: true } } },
    });

    const expenseByCategory: Record<string, number> = {};

    for (const expense of expenses) {
      // COGS and gift totals are cost data.
      if (!canSeeCost && isCostRow(expense)) continue;

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
 * its own transactions, so accounts whose ledger no longer adds up are visible,
 * next to the account's last bank check.
 *
 * A new account starts at a difference of 0: its opening balance is a row. An
 * older account carries a historical difference (opening balances written with
 * no row, overwrites by the old account form) until an admin records it once
 * with recordBalanceBaseline; from then on any difference is new drift.
 */
export async function getAccountReconciliation() {
  await requirePermission('finance.view');
  try {
    // EXPENSE-type accounts hold no real money: COGS and commission stay at 0
    // by design (consignment.ts), so reconciling them only raises false alarms.
    const accounts = await prisma.account.findMany({
      where: { type: { not: 'EXPENSE' } },
      orderBy: { name: 'asc' },
      include: { bankChecks: { orderBy: { checkedAt: 'desc' }, take: 1 } },
    });

    const rows = await Promise.all(
      accounts.map(async (account: any) => {
        const transactions = await prisma.transaction.findMany({
          where: { accountId: account.id },
          select: { type: true, amount: true, description: true, category: true, date: true, createdAt: true },
        });

        const computed = sumBalanceEffects(transactions as any);
        const check = account.bankChecks[0] ?? null;

        return {
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          stored: Number(account.balance),
          computed: Number(computed),
          difference: Number(new Decimal(account.balance).minus(computed)),
          transactionCount: transactions.length,
          lastTransactionAt:
            transactions.length > 0
              ? transactions.reduce(
                  (latest: Date, t: any) => (t.date > latest ? t.date : latest),
                  transactions[0].date as Date,
                )
              : null,
          lastCheck: check
            ? {
                checkedAt: check.checkedAt as Date,
                bankBalance: Number(check.bankBalance),
                erpBalance: Number(check.erpBalance),
                note: check.note as string | null,
              }
            : null,
          // What was entered after the check, so the bank should now hold its
          // figure plus this. The correction an adjustment made with its check
          // carries the check's own time and is not counted; nor is a baseline,
          // which moves no money.
          changeSinceCheck: check
            ? Number(
                sumBalanceEffects(
                  transactions.filter(
                    (t: any) => t.createdAt > check.checkedAt && t.category !== BASELINE_CATEGORY,
                  ) as any,
                ),
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

/** The account row, locked until the surrounding transaction ends. */
async function lockAccount(tx: any, accountId: string) {
  const [account] = await tx.$queryRaw`SELECT id, name, currency, balance FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
  if (!account) throw new Error('حساب یافت نشد.');
  return account as { id: string; name: string; currency: string; balance: Decimal };
}

/**
 * Deliberately correct an account's balance to a known figure (e.g. a bank
 * statement), writing an ADJUSTMENT transaction for the difference so the
 * change is explained and the ledger invariant (balance == Σ transactions)
 * still holds, and keeping the figure as a BankCheck.
 *
 * The account row is locked while the difference is worked out, and the
 * balance moves by that difference, never to an absolute figure: a sale booked
 * at the same moment waits for the lock and then adds on top instead of being
 * overwritten.
 *
 * This replaces the old behaviour where saving the account edit form silently
 * overwrote the balance with no record of what changed or why.
 */
export async function adjustAccountBalance(input: {
  accountId: string;
  targetBalance: number;
  note?: string;
}): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { accountId, targetBalance, note } = input;
  if (!Number.isFinite(targetBalance)) {
    return { success: false, message: 'موجودی جدید معتبر نیست.' };
  }
  const createdById = (await auth())?.user?.id ?? null;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const account = await lockAccount(tx, accountId);

      const current = new Decimal(account.balance);
      const delta = new Decimal(targetBalance).minus(current);
      // The check and its correction share one moment (see getAccountReconciliation).
      const now = new Date();

      await tx.bankCheck.create({
        data: {
          accountId,
          checkedAt: now,
          bankBalance: new Prisma.Decimal(targetBalance),
          erpBalance: current,
          note: note?.trim() || null,
          createdById,
        },
      });

      // A Toman figure typed as the rounded balance the page shows is already
      // right; on a foreign-currency account a cent is money.
      if (delta.abs().lessThan(account.currency === 'TOMAN' ? 0.5 : 0.005)) return { delta: 0, name: account.name };

      await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          // Signed on purpose: an ADJUSTMENT carries no implicit direction, so
          // reconciliation can only re-derive its effect if the sign is stored.
          amount: delta,
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: delta,
          accountId,
          category: 'اصلاح موجودی',
          description:
            (note?.trim() ? `${note.trim()} — ` : '') +
            `اصلاح موجودی از ${Math.round(Number(current)).toLocaleString('fa-IR')} به ${Math.round(targetBalance).toLocaleString('fa-IR')}`,
          date: now,
          createdAt: now,
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });

      return { delta: Number(delta), name: account.name };
    });

    revalidatePath('/dashboard', 'layout');

    return result.delta === 0
      ? { success: true, message: 'موجودی از قبل درست بود؛ رقم بانک ثبت شد و موجودی تغییری نکرد.' }
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

/**
 * «ثبت مانده پایه»: record an account's historical difference once, so its
 * reconciliation starts from 0 and any later difference is new drift.
 *
 * The difference (stored balance − signed sum of its transactions) is history:
 * opening balances written with no row, overwrites by the old account form,
 * legacy rows. This writes ONE ADJUSTMENT row equal to it and leaves
 * Account.balance alone: no money moves, the ledger is only told where it
 * starts. Wrong legacy rows should be fixed first; one fixed afterwards shows
 * up as a new difference.
 */
export async function recordBalanceBaseline(accountId: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // Locked, so no sale lands between reading the balance and summing the rows.
      const account = await lockAccount(tx, accountId);
      // Once per account: a later difference is new drift, to be explained or corrected
      // with «اصلاح موجودی», never folded into the history.
      const existing = await tx.transaction.findFirst({ where: { accountId, category: BASELINE_CATEGORY }, select: { id: true } });
      if (existing) {
        throw new Error('مانده پایهٔ این حساب قبلاً ثبت شده است. اختلاف تازه، اختلاف جدید است: علتش را پیدا کنید یا با «اصلاح موجودی» و عدد صورتحساب بانک اصلاحش کنید.');
      }
      const transactions = await tx.transaction.findMany({
        where: { accountId },
        select: { type: true, amount: true, description: true },
      });
      const difference = new Decimal(account.balance).minus(sumBalanceEffects(transactions));
      if (difference.isZero()) return null;

      await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          amount: difference,
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(1),
          amountInToman: difference,
          accountId,
          category: BASELINE_CATEGORY,
          description: 'مانده پایه — اختلاف قدیمی موجودی ثبت‌شده با جمع تراکنش‌ها؛ موجودی حساب تغییر نکرد',
          date: new Date(),
        },
      });
      return { difference: Number(difference), name: account.name };
    });

    if (!result) {
      return { success: false, message: 'اختلاف این حساب صفر است؛ ثبت مانده پایه لازم نیست.' };
    }

    revalidatePath('/dashboard', 'layout');
    return {
      success: true,
      message: `مانده پایه «${result.name}» ثبت شد (${Math.round(result.difference).toLocaleString('fa-IR')}). موجودی حساب تغییر نکرد و اختلاف آن اکنون صفر است.`,
    };
  } catch (error) {
    console.error('Error recording balance baseline:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در ثبت مانده پایه.',
    };
  }
}

/**
 * «ثبت موجودی بانک»: keep a bank-statement figure next to what the ERP shows
 * now, and change nothing else. The reconciliation page shows the last check
 * and what has been entered since.
 */
export async function recordBankCheck(input: {
  accountId: string;
  bankBalance: number;
  note?: string;
}): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { accountId, bankBalance, note } = input;
  if (!Number.isFinite(bankBalance)) {
    return { success: false, message: 'رقم بانک معتبر نیست.' };
  }

  try {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return { success: false, message: 'حساب یافت نشد.' };

    await prisma.bankCheck.create({
      data: {
        accountId,
        checkedAt: new Date(),
        bankBalance: new Prisma.Decimal(bankBalance),
        erpBalance: account.balance,
        note: note?.trim() || null,
        createdById: (await auth())?.user?.id ?? null,
      },
    });

    revalidatePath('/dashboard/accounting/reconciliation');
    const gap = Number(account.balance) - bankBalance;
    return {
      success: true,
      message:
        Math.abs(gap) < 0.5
          ? 'رقم بانک ثبت شد؛ با موجودی سیستم برابر است.'
          : `رقم بانک ثبت شد. سیستم ${Math.round(Math.abs(gap)).toLocaleString('fa-IR')} ${gap > 0 ? 'بیشتر' : 'کمتر'} از بانک نشان می‌دهد.`,
    };
  } catch (error) {
    console.error('Error recording bank check:', error);
    return { success: false, message: 'خطا در ثبت موجودی بانک.' };
  }
}

export async function getEmployeeDebts() {
  await requirePermission('payroll.view');
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
  await requirePermission('payroll.view');
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
  const denied = await checkPermission('payroll.manage');
  if (denied) return denied;

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

      // The debt is kept in Toman (amountInToman); the cash leaves the account
      // in the account's own currency.
      const { amount: amountInAccountCurrency, rate } = await inAccountCurrency(tx, account, amount);

      const accountBalance = Number(account.balance);
      if (accountBalance < amountInAccountCurrency) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} ${account.currency}، مبلغ مورد نیاز: ${amountInAccountCurrency.toLocaleString('fa-IR')} ${account.currency}`);
      }

      // Money leaves the account, so the row must be an EXPENSE. It was typed
      // INCOME purely so the debt report could net it out, which made every
      // repayment of X drive the stored balance 2X away from the sum of its
      // transactions. The debt report now nets by category instead.
      await tx.transaction.create({
        data: {
          amount: new Prisma.Decimal(amountInAccountCurrency),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
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
            decrement: new Prisma.Decimal(amountInAccountCurrency),
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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
  const requestId = readRequestId(formData.get('requestId'));

  try {
    if (await alreadyBooked(requestId)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

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
          clientRequestId: requestId ?? undefined,
        },
      });
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
      });
    });
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    return { message: error instanceof Error ? error.message : 'خطا در ثبت برداشت.', success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'پرداخت با موفقیت ثبت شد.', success: true };
}

// ─── Internal Transfer ────────────────────────────────────────────────────────

/** Both legs of a transfer made in the app are TRANSFER rows; the prefix gives the direction (see balanceEffect). */
const TRANSFER_CATEGORY = 'انتقال وجه';
const OUT_PREFIX = '[خروج]';
const IN_PREFIX = '[ورود]';

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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
  const requestId = readRequestId(formData.get('requestId'));

  try {
    if (await alreadyBooked(requestId)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

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
    // The two legs share one id, so they are listed, corrected and removed as one transfer.
    const transferGroupId = randomUUID();

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
          category: TRANSFER_CATEGORY,
          description: `${OUT_PREFIX} ${desc}`,
          tags: tagsArr,
          date: txDate,
          receiptUrl: receiptUrl || undefined,
          transferGroupId,
          clientRequestId: requestId ?? undefined,
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
          category: TRANSFER_CATEGORY,
          description: `${IN_PREFIX} ${desc}`,
          tags: tagsArr,
          date: txDate,
          receiptUrl: receiptUrl || undefined,
          transferGroupId,
        },
      });
      await tx.account.update({ where: { id: fromAccountId }, data: { balance: { decrement: new Prisma.Decimal(amount) } } });
      await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: new Prisma.Decimal(amount) } } });
    });
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    return { message: error instanceof Error ? error.message : 'خطا در انتقال وجه.', success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/transfers');
  revalidatePath('/dashboard/accounting/accounts');
  return { message: 'انتقال وجه با موفقیت ثبت شد.', success: true };
}

/**
 * Transfers recorded before transferGroupId existed have no link between their
 * legs. They are paired the way the old code wrote them: a «[خروج]» and a
 * «[ورود]» row of the same amount on two accounts, written in one database
 * transaction, so created within a few seconds of each other.
 */
const LEGACY_TRANSFER_WINDOW_MS = 5000;

type TransferLeg = {
  id: string;
  type: string;
  accountId: string | null;
  amount: unknown;
  currency: string;
  description: string | null;
  date: Date;
  createdAt: Date;
  transferGroupId: string | null;
};

/** Internal transfer rows: legs linked by transferGroupId (app or API), and unlinked app legs marked by their prefix. */
const TRANSFER_ROWS = {
  OR: [
    { transferGroupId: { not: null } },
    {
      transferGroupId: null,
      type: TransactionType.TRANSFER,
      OR: [{ description: { startsWith: OUT_PREFIX } }, { description: { startsWith: IN_PREFIX } }],
    },
  ],
};

/** The leg money leaves, by the same rule the reconciliation reads. */
function isOutgoing(leg: { type: string; description?: string | null }): boolean {
  return balanceEffect({ type: leg.type, amount: 1, description: leg.description }) < 0;
}

function isLegacyPartner(a: TransferLeg, b: TransferLeg): boolean {
  return (
    !a.transferGroupId &&
    !b.transferGroupId &&
    a.id !== b.id &&
    isOutgoing(a) !== isOutgoing(b) &&
    a.accountId !== b.accountId &&
    new Decimal(a.amount as Decimal.Value).equals(b.amount as Decimal.Value) &&
    Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) <= LEGACY_TRANSFER_WINDOW_MS
  );
}

/** Groups transfer rows into pairs, newest first. A leg without a partner is returned alone. */
function pairTransferRows<T extends TransferLeg>(rows: T[]): Array<{ from?: T; to?: T }> {
  const byGroup = new Map<string, { from?: T; to?: T }>();
  const legacy: T[] = [];
  const pairs: Array<{ from?: T; to?: T }> = [];

  for (const row of rows) {
    if (!row.transferGroupId) {
      legacy.push(row);
      continue;
    }
    let pair = byGroup.get(row.transferGroupId);
    if (!pair) {
      pair = {};
      byGroup.set(row.transferGroupId, pair);
      pairs.push(pair);
    }
    if (isOutgoing(row)) pair.from = row;
    else pair.to = row;
  }

  // The two legs of one transfer were written in one database transaction,
  // milliseconds apart, so the closest possible partners are paired first: a
  // leg of the same amount a second away never takes the partner written right
  // beside a leg. loadTransfer pairs with this same function over the same
  // rows, so an edit or a delete acts on exactly the pair shown in the list.
  const byTime = [...legacy].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const candidates: Array<[T, T]> = [];
  for (const [index, row] of byTime.entries()) {
    for (const other of byTime.slice(index + 1)) {
      if (other.createdAt.getTime() - row.createdAt.getTime() > LEGACY_TRANSFER_WINDOW_MS) break;
      if (isLegacyPartner(row, other)) candidates.push([row, other]);
    }
  }
  const gap = ([a, b]: [T, T]) => b.createdAt.getTime() - a.createdAt.getTime();
  const taken = new Set<string>();
  for (const [a, b] of candidates.sort((x, y) => gap(x) - gap(y))) {
    if (taken.has(a.id) || taken.has(b.id)) continue;
    taken.add(a.id);
    taken.add(b.id);
    pairs.push(isOutgoing(a) ? { from: a, to: b } : { from: b, to: a });
  }
  for (const row of byTime) {
    if (!taken.has(row.id)) pairs.push(isOutgoing(row) ? { from: row } : { to: row });
  }

  const at = (pair: { from?: T; to?: T }) => (pair.from ?? pair.to)!.date.getTime();
  return pairs.sort((a, b) => at(b) - at(a));
}

/** A refusal meant for the user, not a crash. */
class TransferRefusal extends Error {}

/** The legs of the transfer `id` names, which is either a group id or one leg's id. */
async function loadTransfer(tx: any, id: string): Promise<{ from?: TransferLeg; to?: TransferLeg; groupId: string | null }> {
  const found: TransferLeg[] = await tx.transaction.findMany({
    where: { AND: [TRANSFER_ROWS, { OR: [{ transferGroupId: id }, { id }] }] },
  });
  if (found.length === 0) throw new TransferRefusal('سند انتقال یافت نشد.');

  const groupId = found[0].transferGroupId ?? null;
  if (!groupId) {
    // A leg written before transferGroupId existed: its partner is the one the
    // transfers list shows beside it, found the same way from the same rows.
    const anchor = found[0];
    const legacy: TransferLeg[] = await tx.transaction.findMany({ where: { AND: [TRANSFER_ROWS, { transferGroupId: null }] } });
    const pair = pairTransferRows(legacy).find((legs) => legs.from?.id === anchor.id || legs.to?.id === anchor.id);
    if (!pair) throw new TransferRefusal('این انتقال هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
    return { from: pair.from, to: pair.to, groupId };
  }

  const legs: TransferLeg[] = await tx.transaction.findMany({ where: { transferGroupId: groupId } });
  return { from: legs.find(isOutgoing), to: legs.find((leg) => !isOutgoing(leg)), groupId };
}

/**
 * Lock the legs and read them again. A second correction of the same transfer
 * waits here, then sees what the first one left: legs it deleted are gone
 * (refused, so nothing is reversed twice) and legs it rewrote are read with
 * their new amounts.
 */
async function lockTransferLegs(tx: any, legs: Array<TransferLeg | undefined>) {
  const ids = legs.filter(Boolean).map((leg) => leg!.id);
  const locked: Array<{ id: string; type: string; accountId: string | null; amount: Decimal; description: string | null }> =
    await tx.$queryRaw`SELECT id, type::text AS type, "accountId", amount, description FROM "Transaction" WHERE id = ANY(${ids}) FOR UPDATE`;
  if (locked.length !== ids.length) {
    throw new TransferRefusal('این انتقال هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
  }
  return locked;
}

/** Undo what a leg did to its account's balance, exactly. */
async function reverseTransferLeg(tx: any, leg: { type: string; accountId: string | null; amount: unknown; description: string | null }) {
  if (!leg.accountId) return;
  const sign = balanceEffect({ type: leg.type, amount: 1, description: leg.description });
  await tx.account.update({
    where: { id: leg.accountId },
    data: { balance: { increment: new Decimal(leg.amount as Decimal.Value).times(-sign) } },
  });
}

/**
 * Correct a recorded internal transfer. The old legs are taken back off their
 * accounts and the new figures applied, in one transaction, so the balances end
 * up as if the transfer had been recorded this way. The same two documents are
 * rewritten; a leg missing from the books is written again.
 */
export async function updateInternalTransfer(input: {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
  description?: string;
}): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = TransferSchema.extend({ id: z.string().min(1) }).safeParse(input);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false, message: first ?? 'اطلاعات وارد شده معتبر نیست.' };
  }
  const { id, amount, fromAccountId, toAccountId, description, date } = parsed.data;
  if (fromAccountId === toAccountId) {
    return { success: false, message: 'حساب مبدأ و مقصد نمی‌توانند یکسان باشند.' };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await loadTransfer(tx, id);
      for (const leg of await lockTransferLegs(tx, [existing.from, existing.to])) {
        await reverseTransferLeg(tx, leg);
      }

      const fromAccount = await tx.account.findUnique({ where: { id: fromAccountId } });
      const toAccount = await tx.account.findUnique({ where: { id: toAccountId } });
      if (!fromAccount || !toAccount) throw new TransferRefusal('حساب یافت نشد.');
      if (fromAccount.currency !== toAccount.currency) {
        throw new TransferRefusal(`ارز دو حساب باید یکسان باشد (${fromAccount.currency} ≠ ${toAccount.currency}).`);
      }
      if (Number(fromAccount.balance) < amount) {
        throw new TransferRefusal(`موجودی حساب "${fromAccount.name}" کافی نیست.`);
      }

      const desc = description?.trim() || `انتقال از ${fromAccount.name} به ${toAccount.name}`;
      const transferGroupId = existing.groupId ?? randomUUID();
      const txDate = date ? new Date(date) : (existing.from ?? existing.to)!.date;
      const leg = (accountId: string, prefix: string) => ({
        amount: new Prisma.Decimal(amount),
        currency: fromAccount.currency,
        rateSnapshot: new Prisma.Decimal(1),
        amountInToman: new Prisma.Decimal(amount),
        accountId,
        description: `${prefix} ${desc}`,
        date: txDate,
        transferGroupId,
      });
      for (const [data, old] of [
        [leg(fromAccountId, OUT_PREFIX), existing.from],
        [leg(toAccountId, IN_PREFIX), existing.to],
      ] as const) {
        if (old) await tx.transaction.update({ where: { id: old.id }, data });
        else await tx.transaction.create({ data: { ...data, type: TransactionType.TRANSFER, category: TRANSFER_CATEGORY } });
      }

      await tx.account.update({ where: { id: fromAccountId }, data: { balance: { decrement: new Prisma.Decimal(amount) } } });
      await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: new Prisma.Decimal(amount) } } });
    });
  } catch (error: unknown) {
    console.error('Error editing internal transfer:', error);
    return {
      success: false,
      message: error instanceof TransferRefusal ? error.message : 'خطا در ویرایش انتقال وجه.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: true, message: 'انتقال وجه اصلاح شد و موجودی حساب‌ها به‌روز شد.' };
}

/** Remove a recorded internal transfer and give both accounts their money back. */
export async function deleteInternalTransfer(id: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await loadTransfer(tx, id);
      const legs = await lockTransferLegs(tx, [existing.from, existing.to]);
      for (const leg of legs) await reverseTransferLeg(tx, leg);
      const { count } = await tx.transaction.deleteMany({ where: { id: { in: legs.map((leg) => leg.id) } } });
      if (count !== legs.length) {
        throw new TransferRefusal('این انتقال هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
      }
    });
  } catch (error: unknown) {
    console.error('Error deleting internal transfer:', error);
    return {
      success: false,
      message: error instanceof TransferRefusal ? error.message : 'خطا در حذف انتقال وجه.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: true, message: 'انتقال وجه حذف شد و موجودی حساب‌ها به حالت قبل برگشت.' };
}

export type TransferHistoryRow = {
  /** What edit and delete take: the transfer's group id, or the id of its first leg. */
  id: string;
  date: Date;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  amount: number;
  currency: string;
  description: string;
  /** False when only one leg of the transfer is in the books. */
  complete: boolean;
};

/** Internal transfers between the company's own accounts, one row per transfer, newest first. */
export async function getInternalTransfers(): Promise<TransferHistoryRow[]> {
  await requirePermission('finance.view');
  try {
    const rows = await prisma.transaction.findMany({
      where: TRANSFER_ROWS,
      include: { account: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });

    return pairTransferRows(rows as any).map((pair) => {
      const { from, to } = pair as { from?: any; to?: any };
      const known = (from ?? to)!;
      return {
        id: known.transferGroupId ?? known.id,
        date: known.date,
        fromAccountId: from?.accountId ?? null,
        toAccountId: to?.accountId ?? null,
        fromAccount: from?.account?.name ?? null,
        toAccount: to?.account?.name ?? null,
        amount: Number(known.amount),
        currency: known.currency,
        description: (known.description ?? '').replace(/^\s*\[(خروج|ورود)\]\s*/, ''),
        complete: Boolean(from && to),
      };
    });
  } catch (error) {
    console.error('Error fetching internal transfers:', error);
    return [];
  }
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
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;

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
  const requestId = readRequestId(formData.get('requestId'));
  const receiptUrl = readReceiptRef(formData.get('receiptUrl'));
  if (receiptUrl === null) return { message: INVALID_RECEIPT_MESSAGE, success: false };

  try {
    if (await alreadyBooked(requestId)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

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
          receiptUrl,
          clientRequestId: requestId ?? undefined,
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: new Prisma.Decimal(amountInAccountCurrency) } },
      });
    });
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    const message = error instanceof Error ? error.message : 'خطا در ثبت واریز.';
    return { message, success: false };
  }

  revalidatePath('/dashboard/accounting/transactions');
  revalidatePath('/dashboard/accounting/accounts');
  revalidatePath('/dashboard/accounting/deposits');
  return { message: 'واریز با موفقیت ثبت شد.', success: true };
}

/**
 * The journal for a period. Without one it used to answer the 100 newest rows,
 * which hid everything older than those 100 whatever period was asked for.
 */
export async function getTransactions(range?: { from?: string; to?: string }) {
  await requirePermission('finance.view');
  try {
    const canSeeCost = await hasPermission('cost.view');
    const from = range?.from ? new Date(range.from) : undefined;
    const to = range?.to ? new Date(range.to) : undefined;
    if (to) to.setHours(23, 59, 59, 999);
    const transactions = await prisma.transaction.findMany({
      where: from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      orderBy: { date: 'desc' },
      include: {
        account: true,
        employee: true,
        marketingGift: { select: { id: true } },
      },
      take: JOURNAL_MAX_ROWS,
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

      // The row stays in the journal; only its cost-valued amount is withheld.
      const hideAmount = !canSeeCost && isCostRow(transaction);

      return {
        ...transaction,
        amount: hideAmount ? null : Number(transaction.amount),
        amountInToman: hideAmount ? null : Number(transaction.amountInToman),
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
