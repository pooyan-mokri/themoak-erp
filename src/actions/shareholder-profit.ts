'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionState, ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// --- Schemas ---

const CalculateProfitSchema = z.object({
  periodStart: z.string().min(1, 'تاریخ شروع دوره الزامی است'),
  periodEnd: z.string().min(1, 'تاریخ پایان دوره الزامی است'),
  description: z.string().optional(),
});

const ShareholderWithdrawalSchema = z.object({
  profitId: z.string().min(1, 'سود الزامی است'),
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب پرداخت الزامی است'),
  description: z.string().optional(),
  date: z.string().optional(),
});

// --- Actions ---

export async function calculateShareholderProfits(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = CalculateProfitSchema.safeParse({
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    description: formData.get('description') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { periodStart, periodEnd, description } = validatedFields.data;
  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);

  try {
    // Check if profit for this period already exists
    const existingProfit = await prisma.shareholderProfit.findFirst({
    where: {
      periodStart: {
        lte: endDate,
      },
      periodEnd: {
        gte: startDate,
      },
    },
  });

    if (existingProfit) {
      return {
        message: 'برای این دوره قبلاً سود محاسبه شده است. لطفا دوره دیگری انتخاب کنید.',
        success: false,
      };
    }
    // Calculate company profit for the period
    // Exclude shareholder deposits and withdrawals from profit calculation
    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
        category: {
          notIn: ['Shareholder Deposit', 'Shareholder Profit Withdrawal'],
        },
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((tx: any) => {
      const amount = Number(tx.amountInToman || tx.amount);
      if (tx.type === 'INCOME') {
        totalIncome += amount;
      } else if (tx.type === 'EXPENSE') {
        totalExpense += amount;
      }
    });

    const netProfit = totalIncome - totalExpense;

    if (netProfit <= 0) {
      return {
        message: 'در این دوره سود محاسبه نشده است. (سود: ' + netProfit.toLocaleString('fa-IR') + ' تومان)',
        success: false,
      };
    }

    // Get all shareholders
    const shareholders = await prisma.shareholder.findMany();

    if (shareholders.length === 0) {
      return {
        message: 'هیچ صاحب سهامی تعریف نشده است.',
        success: false,
      };
    }

    // Calculate total percentage
    const totalPercentage = shareholders.reduce(
  (sum: any, s: any) => sum + Number(s.percentage),
      0
    );

    if (totalPercentage === 0) {
      return {
        message: 'مجموع درصد سهام صفر است.',
        success: false,
      };
    }

    // Create profit records for each shareholder
    await prisma.$transaction(async (tx) => {
      for (const shareholder of shareholders) {
        const percentage = Number(shareholder.percentage);
        const shareholderProfit = (netProfit * percentage) / totalPercentage;

        await tx.shareholderProfit.create({
          data: {
            shareholderId: shareholder.id,
            amount: new Prisma.Decimal(shareholderProfit),
            withdrawn: new Prisma.Decimal(0),
            description: description || `سود دوره ${periodStart} تا ${periodEnd}`,
            periodStart: startDate,
            periodEnd: endDate,
          },
        });
      }
    });

    revalidatePath('/dashboard/accounting/shareholders/profits');
    return {
      message: `سود دوره با موفقیت محاسبه و ثبت شد. (سود کل: ${netProfit.toLocaleString('fa-IR')} تومان)`,
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error calculating shareholder profits:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در محاسبه سود.',
      success: false,
    };
  }
}

export async function withdrawShareholderProfit(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ShareholderWithdrawalSchema.safeParse({
    profitId: formData.get('profitId'),
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

  const { profitId, amount, accountId, description, date } = validatedFields.data;

  try {
    const profit = await prisma.shareholderProfit.findUnique({
      where: { id: profitId },
      include: {
        shareholder: true,
      },
    });

    if (!profit) {
      return {
        message: 'سود یافت نشد.',
        success: false,
      };
    }

    const profitAmount = Number(profit.amount);
    const withdrawnAmount = Number(profit.withdrawn);
    const availableAmount = profitAmount - withdrawnAmount;

    if (amount > availableAmount) {
      return {
        errors: { amount: [`مبلغ قابل برداشت: ${availableAmount.toLocaleString('fa-IR')} تومان`] },
        message: `مبلغ درخواستی بیشتر از سود قابل برداشت است. (قابل برداشت: ${availableAmount.toLocaleString('fa-IR')} تومان)`,
        success: false,
      };
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return {
        message: 'حساب یافت نشد.',
        success: false,
      };
    }

    // Get exchange rate if not TOMAN
    let rate = 1;
    let amountInToman = amount;

    if (account.currency !== 'TOMAN') {
      const latestRate = await prisma.exchangeRate.findFirst({
        where: { currency: account.currency },
        orderBy: { date: 'desc' },
      });

      if (!latestRate) {
        return {
          message: `نرخ ارز برای ${account.currency} یافت نشد.`,
          success: false,
        };
      }

      rate = Number(latestRate.rateToToman);
      amountInToman = amount * rate;
    }

    const transactionDate = date ? new Date(date) : new Date();

    // Create withdrawal and update profit
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          description: description || `برداشت سود توسط ${profit.shareholder.name}`,
          category: 'Shareholder Profit Withdrawal',
          date: transactionDate,
        },
      });

      const withdrawal = await tx.shareholderWithdrawal.create({
        data: {
          profitId,
          amount: new Prisma.Decimal(amount),
          accountId,
          transactionId: transaction.id,
          description: description || undefined,
          date: transactionDate,
        },
      });

      await tx.shareholderProfit.update({
        where: { id: profitId },
        data: {
          withdrawn: {
            increment: new Prisma.Decimal(amount),
          },
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            decrement: new Prisma.Decimal(amountInToman),
          },
        },
      });

      return withdrawal;
    });

    revalidatePath('/dashboard/accounting/shareholders/profits');
    revalidatePath('/dashboard/accounting/shareholders');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${account.currency} با موفقیت برداشت شد.`,
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error withdrawing profit:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در برداشت سود.',
      success: false,
    };
  }
}

export async function getShareholderProfits(shareholderId?: string) {
  try {
    const where = shareholderId ? { shareholderId } : {};
    
    const profits = await prisma.shareholderProfit.findMany({
      where,
      include: {
        shareholder: true,
        withdrawals: {
          include: {
            account: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return profits.map((p: any) => ({
      ...p,
      description: p.description ?? undefined,
      amount: Number(p.amount),
      withdrawn: Number(p.withdrawn),
      available: Number(p.amount) - Number(p.withdrawn),
      shareholder: {
        ...p.shareholder,
        percentage: Number(p.shareholder.percentage),
        phone: p.shareholder.phone ?? undefined,
        email: p.shareholder.email ?? undefined,
        address: p.shareholder.address ?? undefined,
        notes: p.shareholder.notes ?? undefined,
      },
    }));
  } catch (error) {
    console.error('Error fetching shareholder profits:', error);
    return [];
  }
}

export async function getShareholderProfitById(id: string) {
  try {
    const profit = await prisma.shareholderProfit.findUnique({
      where: { id },
      include: {
        shareholder: true,
        withdrawals: {
          include: {
            account: true,
            transaction: true,
          },
        },
      },
    });

    if (!profit) return undefined;

    return {
      ...profit,
      description: profit.description ?? undefined,
      amount: Number(profit.amount),
      withdrawn: Number(profit.withdrawn),
      available: Number(profit.amount) - Number(profit.withdrawn),
      shareholder: {
        ...profit.shareholder,
        percentage: Number(profit.shareholder.percentage),
        phone: profit.shareholder.phone ?? undefined,
        email: profit.shareholder.email ?? undefined,
        address: profit.shareholder.address ?? undefined,
        notes: profit.shareholder.notes ?? undefined,
      },
    };
  } catch (error) {
    console.error('Error fetching shareholder profit:', error);
    return undefined;
  }
}

