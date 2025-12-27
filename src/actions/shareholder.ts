'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// --- Schemas ---

const ShareholderSchema = z.object({
  name: z.string().min(1, 'نام صاحب سهام الزامی است'),
  percentage: z.coerce.number().min(0).max(100, 'درصد باید بین 0 تا 100 باشد'),
  phone: z.string().optional(),
  email: z.string().email('ایمیل نامعتبر است').optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const ShareholderDepositSchema = z.object({
  shareholderId: z.string().min(1, 'صاحب سهام الزامی است'),
  accountId: z.string().min(1, 'حساب واریزی الزامی است'),
  amount: z.coerce.number().min(1, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  description: z.string().optional(),
  date: z.string().optional(),
});

// --- Actions ---

export async function createShareholder(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ShareholderSchema.safeParse({
    name: formData.get('name'),
    percentage: formData.get('percentage'),
    phone: formData.get('phone') || undefined,
    email: formData.get('email') || undefined,
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { name, percentage, phone, email, address, notes } = validatedFields.data;

  try {
    // Check total percentage
    const existingShareholders = await prisma.shareholder.findMany();
    const totalPercentage = existingShareholders.reduce(
      (sum, s) => sum + Number(s.percentage),
      0
    );

    if (totalPercentage + percentage > 100) {
      return {
        errors: { percentage: ['مجموع درصد سهام نمی‌تواند بیشتر از 100 باشد.'] },
        message: `درصد کل سهام نمی‌تواند بیشتر از 100 باشد. (درصد فعلی: ${totalPercentage.toFixed(2)}%)`,
        success: false,
      };
    }

    await prisma.shareholder.create({
      data: {
        name,
        percentage: new Prisma.Decimal(percentage),
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        notes: notes || undefined,
      },
    });

    revalidatePath('/dashboard/accounting/shareholders');
    return { message: 'صاحب سهام با موفقیت ایجاد شد.', success: true };
  } catch (error: unknown) {
    console.error('Error creating shareholder:', error);
    const message = error instanceof Error ? error.message : 'خطا در ایجاد صاحب سهام.';
    return {
      message,
      success: false,
    };
  }
}

export async function updateShareholder(id: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ShareholderSchema.safeParse({
    name: formData.get('name'),
    percentage: formData.get('percentage'),
    phone: formData.get('phone') || undefined,
    email: formData.get('email') || undefined,
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { name, percentage, phone, email, address, notes } = validatedFields.data;

  try {
    // Check total percentage (excluding current shareholder)
    const currentShareholder = await prisma.shareholder.findUnique({
      where: { id },
      select: { percentage: true },
    });

    const existingShareholders = await prisma.shareholder.findMany({
      where: { NOT: { id } },
    });

    const totalPercentage = existingShareholders.reduce(
      (sum, s) => sum + Number(s.percentage),
      0
    );

    if (totalPercentage + percentage > 100) {
      return {
        errors: { percentage: ['مجموع درصد سهام نمی‌تواند بیشتر از 100 باشد.'] },
        message: `درصد کل سهام نمی‌تواند بیشتر از 100 باشد. (درصد فعلی دیگران: ${totalPercentage.toFixed(2)}%)`,
        success: false,
      };
    }

    await prisma.shareholder.update({
      where: { id },
      data: {
        name,
        percentage: new Prisma.Decimal(percentage),
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        notes: notes || undefined,
      },
    });

    revalidatePath('/dashboard/accounting/shareholders');
    return { message: 'صاحب سهام با موفقیت به‌روزرسانی شد.', success: true };
  } catch (error: unknown) {
    console.error('Error updating shareholder:', error);
    const message = error instanceof Error ? error.message : 'خطا در به‌روزرسانی صاحب سهام.';
    return {
      message,
      success: false,
    };
  }
}

export async function deleteShareholder(id: string): Promise<ActionResult> {
  try {
    // Check if shareholder has transactions
    const transactions = await prisma.transaction.findMany({
      where: { shareholderId: id },
    });

    if (transactions.length > 0) {
      return {
        success: false,
        message: `نمی‌توان این صاحب سهام را حذف کرد چون ${transactions.length} تراکنش مرتبط دارد.`,
      };
    }

    await prisma.shareholder.delete({
      where: { id },
    });

    revalidatePath('/dashboard/accounting/shareholders');
    return { success: true, message: 'صاحب سهام با موفقیت حذف شد.' };
  } catch (error: unknown) {
    console.error('Error deleting shareholder:', error);
    const message = error instanceof Error ? error.message : 'خطا در حذف صاحب سهام.';
    return {
      success: false,
      message,
    };
  }
}

export async function getShareholders() {
  try {
    const shareholders = await prisma.shareholder.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });

    return shareholders.map((s: any) => ({
      ...s,
      percentage: Number(s.percentage),
      phone: s.phone ?? undefined,
      email: s.email ?? undefined,
      address: s.address ?? undefined,
      notes: s.notes ?? undefined,
    }));
  } catch (error) {
    console.error('Error fetching shareholders:', error);
    return [];
  }
}

export async function getShareholderById(id: string) {
  try {
    const shareholder = await prisma.shareholder.findUnique({
      where: { id },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });

    if (!shareholder) return undefined;

    return {
      ...shareholder,
      percentage: Number(shareholder.percentage),
      phone: shareholder.phone ?? undefined,
      email: shareholder.email ?? undefined,
      address: shareholder.address ?? undefined,
      notes: shareholder.notes ?? undefined,
    };
  } catch (error) {
    console.error('Error fetching shareholder:', error);
    return undefined;
  }
}

/**
 * Deposit funds from shareholder (creates Accounts Payable - company owes shareholder)
 * When shareholder deposits money, the company receives it but owes it back as a debt
 */
export async function depositShareholderFunds(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ShareholderDepositSchema.safeParse({
    shareholderId: formData.get('shareholderId'),
    accountId: formData.get('accountId'),
    amount: formData.get('amount'),
    currency: formData.get('currency'),
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

  const { shareholderId, accountId, amount, currency, description, date } = validatedFields.data;

  try {
    // Get shareholder and account
    const shareholder = await prisma.shareholder.findUnique({
      where: { id: shareholderId },
    });

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!shareholder) {
      return {
        message: 'صاحب سهام یافت نشد.',
        success: false,
      };
    }

    if (!account) {
      return {
        message: 'حساب یافت نشد.',
        success: false,
      };
    }

    // Get exchange rate if not TOMAN
    let rate = 1;
    let amountInToman = amount;

    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency },
        orderBy: { date: 'desc' },
      });

      if (!latestRate) {
        return {
          message: `نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ ارز را ثبت کنید.`,
          success: false,
        };
      }

      rate = Number(latestRate.rateToToman);
      amountInToman = amount * rate;
    }

    const transactionDate = date ? new Date(date) : new Date();

    // Create transaction and update account balance
    // Type: INCOME (money comes in) but with shareholderId (creates Accounts Payable - debt to shareholder)
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.INCOME,
          amount: new Prisma.Decimal(amount),
          currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          shareholderId,
          description: description || `واریز سرمایه توسط ${shareholder.name} (بدهی به سهامدار)`,
          category: 'Shareholder Deposit',
          date: transactionDate,
        },
      });

      // Increase account balance (money received)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            increment: new Prisma.Decimal(amountInToman),
          },
        },
      });

      return transaction;
    });

    revalidatePath('/dashboard/accounting/shareholders');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${currency} با موفقیت واریز شد. (سهامدار طلبکار شد)`,
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error depositing funds:', error);
    const message = error instanceof Error ? error.message : 'خطا در واریز مبلغ.';
    return {
      message,
      success: false,
    };
  }
}

/**
 * Withdraw funds to shareholder (creates Accounts Receivable - shareholder owes company)
 * When shareholder withdraws money, the company pays it but shareholder owes it back as debt
 */
const ShareholderWithdrawalSchema = z.object({
  shareholderId: z.string().min(1, 'صاحب سهام الزامی است'),
  accountId: z.string().min(1, 'حساب پرداخت الزامی است'),
  amount: z.coerce.number().min(1, 'مبلغ باید بیشتر از صفر باشد'),
  currency: z.nativeEnum(Currency),
  description: z.string().optional(),
  date: z.string().optional(),
});

export async function withdrawShareholderFunds(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ShareholderWithdrawalSchema.safeParse({
    shareholderId: formData.get('shareholderId'),
    accountId: formData.get('accountId'),
    amount: formData.get('amount'),
    currency: formData.get('currency'),
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

  const { shareholderId, accountId, amount, currency, description, date } = validatedFields.data;

  try {
    // Get shareholder and account
    const shareholder = await prisma.shareholder.findUnique({
      where: { id: shareholderId },
    });

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!shareholder) {
      return {
        message: 'صاحب سهام یافت نشد.',
        success: false,
      };
    }

    if (!account) {
      return {
        message: 'حساب یافت نشد.',
        success: false,
      };
    }

    // Get exchange rate if not TOMAN
    let rate = 1;
    let amountInToman = amount;

    if (currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency },
        orderBy: { date: 'desc' },
      });

      if (!latestRate) {
        return {
          message: `نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ ارز را ثبت کنید.`,
          success: false,
        };
      }

      rate = Number(latestRate.rateToToman);
      amountInToman = amount * rate;
    }

    // Check account balance
    const accountBalance = Number(account.balance);
    if (accountBalance < amountInToman) {
      return {
        message: `موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} تومان، مبلغ مورد نیاز: ${amountInToman.toLocaleString('fa-IR')} تومان`,
        success: false,
      };
    }

    const transactionDate = date ? new Date(date) : new Date();

    // Create transaction and update account balance
    // Type: EXPENSE (money goes out) but with shareholderId (creates Accounts Receivable - shareholder owes company)
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(amount),
          currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          shareholderId,
          description: description || `برداشت سرمایه توسط ${shareholder.name} (طلب از سهامدار)`,
          category: 'Shareholder Withdrawal',
          date: transactionDate,
        },
      });

      // Decrease account balance (money paid out)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amountInToman),
          },
        },
      });

      return transaction;
    });

    revalidatePath('/dashboard/accounting/shareholders');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${currency} با موفقیت پرداخت شد. (سهامدار بدهکار شد)`,
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error withdrawing funds:', error);
    const message = error instanceof Error ? error.message : 'خطا در پرداخت مبلغ.';
    return {
      message,
      success: false,
    };
  }
}

/**
 * Calculate shareholder debt/receivable balance
 * Returns positive value = company owes shareholder (Accounts Payable)
 * Returns negative value = shareholder owes company (Accounts Receivable)
 */
export async function getShareholderBalance(shareholderId: string): Promise<number> {
  try {
    // Get all INCOME transactions (deposits - company owes shareholder)
    const deposits = await prisma.transaction.findMany({
      where: {
        shareholderId,
        type: TransactionType.INCOME,
        category: 'Shareholder Deposit',
      },
    });

    // Get all EXPENSE transactions (withdrawals - shareholder owes company)
    const withdrawals = await prisma.transaction.findMany({
      where: {
        shareholderId,
        type: TransactionType.EXPENSE,
        category: 'Shareholder Withdrawal',
      },
    });

    const totalDeposits = deposits.reduce(
      (sum, tx) => sum + Number(tx.amountInToman),
      0
    );
    const totalWithdrawals = withdrawals.reduce(
      (sum, tx) => sum + Number(tx.amountInToman),
      0
    );

    // Positive = company owes shareholder (Accounts Payable)
    // Negative = shareholder owes company (Accounts Receivable)
    return totalDeposits - totalWithdrawals;
  } catch (error) {
    console.error('Error calculating shareholder balance:', error);
    return 0;
  }
}

/**
 * Get all shareholders with their debt/receivable balances
 */
export async function getShareholdersWithBalance() {
  try {
    const shareholders = await prisma.shareholder.findMany({
      orderBy: { name: 'asc' },
    });

    const shareholdersWithBalance = await Promise.all(
      shareholders.map(async (shareholder) => {
        const balance = await getShareholderBalance(shareholder.id);
        return {
          ...shareholder,
          percentage: Number(shareholder.percentage),
          phone: shareholder.phone ?? undefined,
          email: shareholder.email ?? undefined,
          address: shareholder.address ?? undefined,
          notes: shareholder.notes ?? undefined,
          balance, // Positive = company owes, Negative = shareholder owes
        };
      })
    );

    return shareholdersWithBalance;
  } catch (error) {
    console.error('Error fetching shareholders with balance:', error);
    return [];
  }
}

