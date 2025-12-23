'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// --- Schemas ---

const LoanSchema = z.object({
  borrowerId: z.string().min(1, 'گیرنده قرض الزامی است'),
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  interestRate: z.coerce.number().min(0).max(100, 'نرخ بهره باید بین 0 تا 100 باشد').optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
});

const LoanPaymentSchema = z.object({
  loanId: z.string().min(1, 'قرض الزامی است'),
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  principal: z.coerce.number().min(0).optional(),
  interest: z.coerce.number().min(0).optional(),
  accountId: z.string().min(1, 'حساب پرداخت الزامی است'),
  description: z.string().optional(),
  date: z.string().optional(),
});

// --- Actions ---

export async function createLoan(prevState: any, formData: FormData) {
  const validatedFields = LoanSchema.safeParse({
    borrowerId: formData.get('borrowerId'),
    amount: formData.get('amount'),
    interestRate: formData.get('interestRate') || undefined,
    description: formData.get('description') || undefined,
    dueDate: formData.get('dueDate') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { borrowerId, amount, interestRate, description, dueDate } = validatedFields.data;

  try {
    // Verify employee exists (loans are only to employees)
    const employee = await prisma.employee.findUnique({
      where: { id: borrowerId },
    });

    if (!employee) {
      return {
        message: 'کارمند یافت نشد.',
        success: false,
      };
    }

    await prisma.loan.create({
      data: {
        employeeId: borrowerId,
        amount: new Prisma.Decimal(amount),
        remaining: new Prisma.Decimal(amount),
        interestRate: interestRate ? new Prisma.Decimal(interestRate) : new Prisma.Decimal(0),
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'ACTIVE',
      },
    });

    revalidatePath('/dashboard/accounting/loans');
    return { message: 'قرض با موفقیت ثبت شد.', success: true };
  } catch (error: any) {
    console.error('Error creating loan:', error);
    return {
      message: error.message || 'خطا در ثبت قرض.',
      success: false,
    };
  }
}

export async function recordLoanPayment(prevState: any, formData: FormData) {
  const validatedFields = LoanPaymentSchema.safeParse({
    loanId: formData.get('loanId'),
    amount: formData.get('amount'),
    principal: formData.get('principal') || undefined,
    interest: formData.get('interest') || undefined,
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

  const { loanId, amount, principal, interest, accountId, description, date } = validatedFields.data;

  try {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        employee: true,
      },
    });

    if (!loan) {
      return {
        message: 'قرض یافت نشد.',
        success: false,
      };
    }

    const remainingAmount = Number(loan.remaining);

    if (amount > remainingAmount) {
      return {
        errors: { amount: [`مبلغ باقیمانده: ${remainingAmount.toLocaleString('fa-IR')} تومان`] },
        message: `مبلغ پرداختی بیشتر از باقیمانده قرض است. (باقیمانده: ${remainingAmount.toLocaleString('fa-IR')} تومان)`,
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

    // Calculate principal and interest if not provided
    const principalAmount = principal !== undefined ? principal : amount;
    const interestAmount = interest !== undefined ? interest : 0;

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
    const newRemaining = remainingAmount - principalAmount;

    // Create payment and update loan
    await prisma.$transaction(async (tx: any) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.INCOME,
          amount: new Prisma.Decimal(amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          description: description || `بازپرداخت قرض - ${loan.employee.name}`,
          category: 'Loan Payment',
          date: transactionDate,
        },
      });

      await tx.loanPayment.create({
        data: {
          loanId,
          amount: new Prisma.Decimal(amount),
          principal: new Prisma.Decimal(principalAmount),
          interest: new Prisma.Decimal(interestAmount),
          accountId,
          transactionId: transaction.id,
          description: description || null,
          date: transactionDate,
        },
      });

      await tx.loan.update({
        where: { id: loanId },
        data: {
          remaining: new Prisma.Decimal(newRemaining),
          status: newRemaining <= 0 ? 'PAID' : 'ACTIVE',
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            increment: new Prisma.Decimal(amountInToman),
          },
        },
      });
    });

    revalidatePath('/dashboard/accounting/loans');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${account.currency} با موفقیت ثبت شد.`,
      success: true,
    };
  } catch (error: any) {
    console.error('Error recording loan payment:', error);
    return {
      message: error.message || 'خطا در ثبت بازپرداخت.',
      success: false,
    };
  }
}

export async function getLoans(status?: string) {
  try {
    const where = status ? { status } : {};
    
    const loans = await prisma.loan.findMany({
      where,
      include: {
        employee: true,
        payments: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return loans.map((l) => ({
      ...l,
      amount: Number(l.amount),
      remaining: Number(l.remaining),
      interestRate: Number(l.interestRate),
    }));
  } catch (error) {
    console.error('Error fetching loans:', error);
    return [];
  }
}

export async function getLoanById(id: string) {
  try {
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        employee: true,
        payments: {
          include: {
            account: true,
            transaction: true,
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!loan) return null;

    return {
      ...loan,
      amount: Number(loan.amount),
      remaining: Number(loan.remaining),
      interestRate: Number(loan.interestRate),
      payments: loan.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
        principal: Number(p.principal),
        interest: Number(p.interest),
      })),
    };
  } catch (error) {
    console.error('Error fetching loan:', error);
    return null;
  }
}

