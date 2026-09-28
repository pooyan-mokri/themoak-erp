'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType, ActionState, ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { checkPermission, getCurrentRole, requirePermission } from '@/lib/access';
import { userMessage } from '@/lib/action-error';
import { logActivity } from '@/lib/activity-log';
import { toLatinDigits } from '@/lib/digits';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';

/** A submission already booked under this id (src/lib/request-id.ts). */
async function alreadyBooked(client: any, requestId: string | null): Promise<boolean> {
  return !!requestId && !!(await client.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }));
}
import { auth } from '@/auth';

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
  const denied = await checkPermission('payroll.manage');
  if (denied) return denied;

  const validatedFields = PayrollSchema.safeParse({
    employeeId: formData.get('employeeId'),
    // A Persian keyboard types ۰–۹, which Number cannot read (src/lib/digits.ts).
    amount: toLatinDigits(formData.get('amount')),
    bonuses: toLatinDigits(formData.get('bonuses')) || undefined,
    deductions: toLatinDigits(formData.get('deductions')) || undefined,
    periodMonth: toLatinDigits(formData.get('periodMonth')),
    periodYear: toLatinDigits(formData.get('periodYear')),
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
    // As updatePayroll: a payslip that pays nothing or less than nothing is a typo.
    if (!(netAmount > 0)) {
      return { message: 'حقوق خالص (حقوق + پاداش − کسورات) باید بیشتر از صفر باشد.', success: false };
    }

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
      message: userMessage(error, 'خطا در ثبت فیش حقوقی.'),
      success: false,
    };
  }
}

export async function recordPayrollPayment(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('payroll.manage');
  if (denied) return denied;

  const validatedFields = PayrollPaymentSchema.safeParse({
    payrollId: formData.get('payrollId'),
    amount: toLatinDigits(formData.get('amount')),
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
  const requestId = readRequestId(formData.get('requestId'));

  try {
    // The same submission again (a retry, a double click): it was booked once.
    if (await alreadyBooked(prisma, requestId)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

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

    // The payment form is Toman-denominated (capped at the remaining net pay,
    // which is Toman), so `amount` IS the Toman figure. The cash leaves the
    // account in the account's own currency.
    const amountInToman = amount;
    const { amount: amountInAccountCurrency, rate } =
      await inAccountCurrency(prisma, account, amountInToman);

    const transactionDate = date ? new Date(date) : new Date();

    // Create payment and update payroll
    const outcome = await prisma.$transaction(async (tx: any) => {
      // The payslip is locked and read again: a second payment, or an edit of
      // it, at the same moment waits, and paid never goes above the net pay.
      await tx.$queryRaw`SELECT id FROM "Payroll" WHERE id = ${payrollId} FOR UPDATE`;
      // A copy of this submission that waited here finds it booked.
      if (await alreadyBooked(tx, requestId)) return 'duplicate';
      const current = await tx.payroll.findUnique({ where: { id: payrollId } });
      const currentNet = Number(current.netAmount);
      const paidSoFar = Number(current.paidAmount);
      if (amount > currentNet - paidSoFar) {
        throw new Error(
          `مبلغ پرداختی بیشتر از باقیمانده است. (باقیمانده: ${(currentNet - paidSoFar).toLocaleString('fa-IR')} تومان)`,
        );
      }
      const newPaidAmount = paidSoFar + amount;
      const newStatus = newPaidAmount >= currentNet ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : 'PENDING';

      // As every other payment: the account must cover it.
      const payer = await tx.account.findUnique({ where: { id: accountId } });
      if (Number(payer.balance) < amountInAccountCurrency) {
        throw new Error(`موجودی حساب "${payer.name}" کافی نیست.`);
      }

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(amountInAccountCurrency),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(rate),
          amountInToman: new Prisma.Decimal(amountInToman),
          accountId,
          description: description || `پرداخت حقوق - ${payroll.employee.name} - ${payroll.periodYear}/${payroll.periodMonth}`,
          category: 'Salary',
          date: transactionDate,
          clientRequestId: requestId ?? undefined,
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
            decrement: new Prisma.Decimal(amountInAccountCurrency),
          },
        },
      });
      return 'booked';
    });
    if (outcome === 'duplicate') return { message: DUPLICATE_REQUEST_MESSAGE, success: true };

    revalidatePath('/dashboard/accounting/payroll');
    revalidatePath('/dashboard/accounting/transactions');
    revalidatePath('/dashboard/accounting/accounts');
    return {
      message: `مبلغ ${amount.toLocaleString('fa-IR')} ${account.currency} با موفقیت ثبت شد.`,
      success: true,
    };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    console.error('Error recording payroll payment:', error);
    return {
      message: userMessage(error, 'خطا در ثبت پرداخت.'),
      success: false,
    };
  }
}

const PayrollEditSchema = z.object({
  amount: z.coerce.number().min(0.01, 'حقوق پایه باید بیشتر از صفر باشد'),
  bonuses: z.coerce.number().min(0, 'پاداش نمی‌تواند منفی باشد'),
  deductions: z.coerce.number().min(0, 'کسورات نمی‌تواند منفی باشد'),
  description: z.string().optional(),
});

/**
 * Correct a payslip already recorded — the base pay, a bonus or sales
 * commission added, a deduction. Admin only, and written to the activity log.
 * It moves no money: payments already made stay exactly as they are, and the
 * payslip's status follows its new net pay. A net pay below what has already
 * been paid is refused.
 */
export async function updatePayroll(
  payrollId: string,
  input: { amount: number; bonuses: number; deductions: number; description?: string },
): Promise<ActionResult> {
  if ((await getCurrentRole()) !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند فیش حقوقی را ویرایش کند.' };
  }
  const parsed = PayrollEditSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.flatten().fieldErrors, message: 'مبلغ‌ها را درست وارد کنید.' };
  }
  const { amount, bonuses, deductions, description } = parsed.data;
  const netAmount = amount + bonuses - deductions;
  if (!(netAmount > 0)) return { success: false, message: 'حقوق خالص (حقوق + پاداش − کسورات) باید بیشتر از صفر باشد.' };

  try {
    const change = await prisma.$transaction(async (tx: any) => {
      // One edit or payment at a time on this payslip.
      const locked = await tx.$queryRaw`SELECT id FROM "Payroll" WHERE id = ${payrollId} FOR UPDATE`;
      if (locked.length === 0) throw new Error('فیش حقوقی یافت نشد.');
      const payroll = await tx.payroll.findUnique({ where: { id: payrollId }, include: { employee: true } });
      const paid = Number(payroll.paidAmount);
      if (netAmount < paid - 0.01) {
        throw new Error(
          `حقوق خالص جدید (${Math.round(netAmount).toLocaleString('fa-IR')} تومان) کمتر از مبلغی است که پرداخت شده ` +
            `(${Math.round(paid).toLocaleString('fa-IR')} تومان).`,
        );
      }
      await tx.payroll.update({
        where: { id: payrollId },
        data: {
          amount: new Prisma.Decimal(amount),
          bonuses: new Prisma.Decimal(bonuses),
          deductions: new Prisma.Decimal(deductions),
          netAmount: new Prisma.Decimal(netAmount),
          description: description === undefined ? undefined : description || null,
          status: paid >= netAmount - 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING',
        },
      });
      return {
        who: `${payroll.employee.name} ${payroll.periodYear}/${payroll.periodMonth}`,
        before: Number(payroll.netAmount),
      };
    });

    const session = await auth();
    await logActivity(
      session?.user?.id,
      'UPDATE_PAYROLL',
      `فیش حقوقی ${change.who} ویرایش شد: خالص ${Math.round(change.before).toLocaleString('en-US')} → ${Math.round(netAmount).toLocaleString('en-US')} تومان ` +
        `(حقوق ${amount}، پاداش ${bonuses}، کسورات ${deductions}).`,
    );
  } catch (error: unknown) {
    return { success: false, message: userMessage(error, 'خطا در ویرایش فیش حقوقی.') };
  }

  revalidatePath('/dashboard/accounting/payroll');
  return { success: true, message: 'فیش حقوقی ویرایش شد.' };
}

export async function getPayrolls(employeeId?: string, status?: string) {
  await requirePermission('payroll.view');
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

    return payrolls.map((p: any) => ({
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
      payments: p.payments.map((payment: any) => ({
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
  await requirePermission('payroll.view');
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
      payments: payroll.payments.map((p: any) => ({
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

