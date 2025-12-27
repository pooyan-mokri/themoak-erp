'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionState, ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// --- Schemas ---

const PayrollSchema = z.object({
  employeeId: z.string().min(1, 'کارمند الزامی است'),
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  bonuses: z.coerce.number().min(0).optional(),
  deductions: z.coerce.number().min(0).optional(),
  periodMonth: z.coerce.number().min(1).max(12, 'ماه باید بین 1 تا 12 باشد'),
  periodYear: z.coerce.number().min(1400, 'سال باید معتبر باشد'),
  description: z.string().optional(),
});

const PayrollPaymentSchema = z.object({
  payrollId: z.string().min(1, 'فیش حقوقی الزامی است'),
  amount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب پرداخت الزامی است'),
  description: z.string().optional(),
  date: z.string().optional(),
});

// --- Actions ---

export async function createPayroll(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = PayrollSchema.safeParse({
    employeeId: formData.get('employeeId'),
    amount: formData.get('amount'),
    bonuses: formData.get('bonuses') || undefined,
    deductions: formData.get('deductions') || undefined,
    periodMonth: formData.get('periodMonth'),
    periodYear: formData.get('periodYear'),
    description: formData.get('description') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { employeeId, amount, bonuses = 0, deductions = 0, periodMonth, periodYear, description } = validatedFields.data;

  try {
    // Check if payroll for this period already exists
    const existingPayroll = await prisma.payroll.findUnique({
      where: {
        employeeId_periodMonth_periodYear: {
          employeeId,
          periodMonth,
          periodYear,
        },
      },
    });

    if (existingPayroll) {
      return {
        message: 'برای این دوره قبلاً فیش حقوقی ثبت شده است.',
        success: false,
      };
    }

    // Verify employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return {
        message: 'کارمند یافت نشد.',
        success: false,
      };
    }

    const netAmount = amount + bonuses - deductions;

    await prisma.payroll.create({
      data: {
        employeeId,
        amount: new Prisma.Decimal(amount),
        bonuses: new Prisma.Decimal(bonuses),
        deductions: new Prisma.Decimal(deductions),
        netAmount: new Prisma.Decimal(netAmount),
        paidAmount: new Prisma.Decimal(0),
        periodMonth,
        periodYear,
        description: description || undefined,
        status: 'PENDING',
      },
    });

    revalidatePath('/dashboard/accounting/payroll');
    return { message: 'فیش حقوقی با موفقیت ثبت شد.', success: true };
  } catch (error: unknown) {
    console.error('Error creating payroll:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در ثبت فیش حقوقی.',
      success: false,
    };
  }
}

export async function recordPayrollPayment(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = PayrollPaymentSchema.safeParse({
    payrollId: formData.get('payrollId'),
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

  const { payrollId, amount, accountId, description, date } = validatedFields.data;

  try {
    const payroll = await prisma.payroll.findUnique({
      where: { id: payrollId },
      include: {
        employee: true,
      },
    });

    if (!payroll) {
      return {
        message: 'فیش حقوقی یافت نشد.',
        success: false,
      };
    }

    const netAmount = Number(payroll.netAmount);
    const currentPaidAmount = Number(payroll.paidAmount);
    const remainingAmount = netAmount - currentPaidAmount;

    if (amount > remainingAmount) {
      return {
        errors: { amount: [`مبلغ باقیمانده: ${remainingAmount.toLocaleString('fa-IR')} تومان`] },
        message: `مبلغ پرداختی بیشتر از باقیمانده است. (باقیمانده: ${remainingAmount.toLocaleString('fa-IR')} تومان)`,
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
    const newPaidAmount = currentPaidAmount + amount;
    const newStatus = newPaidAmount >= netAmount ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : 'PENDING';

    // Create payment and update payroll
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          description: description || `پرداخت حقوق - ${payroll.employee.name} - ${payroll.periodYear}/${payroll.periodMonth}`,
          category: 'Salary',
          date: transactionDate,
        },
      });

      await tx.payrollPayment.create({
        data: {
          payrollId,
          amount: new Prisma.Decimal(amount),
          accountId,
          transactionId: transaction.id,
          description: description || undefined,
          date: transactionDate,
        },
      });

      await tx.payroll.update({
        where: { id: payrollId },
        data: {
          paidAmount: new Prisma.Decimal(newPaidAmount),
          status: newStatus,
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
    });

    revalidatePath('/dashboard/accounting/payroll');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${account.currency} با موفقیت ثبت شد.`,
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error recording payroll payment:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در ثبت پرداخت.',
      success: false,
    };
  }
}

export async function getPayrolls(employeeId?: string, status?: string) {
  try {
    const where: { employeeId?: string; status?: string } = {};
    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (status) {
      where.status = status;
    }

    const payrolls = await prisma.payroll.findMany({
      where,
      include: {
        employee: true,
        payments: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: [
        { periodYear: 'desc' },
        { periodMonth: 'desc' },
      ],
    });

    return payrolls.map((p) => ({
      ...p,
      amount: Number(p.amount),
      bonuses: Number(p.bonuses) || 0,
      deductions: Number(p.deductions) || 0,
      netAmount: Number(p.netAmount),
      paidAmount: Number(p.paidAmount),
      description: p.description ?? undefined,
      employee: {
        ...p.employee,
        salary: Number(p.employee.salary),
        userId: p.employee.userId ?? undefined,
        nationalId: p.employee.nationalId ?? undefined,
        phone: p.employee.phone ?? undefined,
        email: p.employee.email ?? undefined,
        address: p.employee.address ?? undefined,
        position: p.employee.position ?? undefined,
        hireDate: p.employee.hireDate ?? undefined,
      },
      payments: p.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
        description: payment.description ?? undefined,
      })),
    }));
  } catch (error) {
    console.error('Error fetching payrolls:', error);
    return [];
  }
}

export async function getPayrollById(id: string) {
  try {
    const payroll = await prisma.payroll.findUnique({
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

    if (!payroll) return undefined;

    return {
      ...payroll,
      amount: Number(payroll.amount),
      bonuses: Number(payroll.bonuses) || 0,
      deductions: Number(payroll.deductions) || 0,
      netAmount: Number(payroll.netAmount),
      paidAmount: Number(payroll.paidAmount),
      description: payroll.description ?? undefined,
      employee: {
        ...payroll.employee,
        salary: Number(payroll.employee.salary),
        userId: payroll.employee.userId ?? undefined,
        nationalId: payroll.employee.nationalId ?? undefined,
        phone: payroll.employee.phone ?? undefined,
        email: payroll.employee.email ?? undefined,
        address: payroll.employee.address ?? undefined,
        position: payroll.employee.position ?? undefined,
        hireDate: payroll.employee.hireDate ?? undefined,
      },
      payments: payroll.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
        description: p.description ?? undefined,
        account: {
          ...p.account,
          balance: Number(p.account.balance),
        },
        transaction: p.transaction ? {
          ...p.transaction,
          amount: Number(p.transaction.amount),
          amountInToman: Number(p.transaction.amountInToman),
          rateSnapshot: Number(p.transaction.rateSnapshot),
          description: p.transaction.description ?? undefined,
          category: p.transaction.category ?? undefined,
          accountId: p.transaction.accountId ?? undefined,
          projectId: p.transaction.projectId ?? undefined,
          employeeId: p.transaction.employeeId ?? undefined,
          shareholderId: p.transaction.shareholderId ?? undefined,
          receiptUrl: p.transaction.receiptUrl ?? undefined,
          wooId: p.transaction.wooId ?? undefined,
          wooStatus: p.transaction.wooStatus ?? undefined,
        } : undefined,
      })),
    };
  } catch (error) {
    console.error('Error fetching payroll:', error);
    return undefined;
  }
}

