'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { TransactionType, Currency, ActionResult } from '@/lib/types';
import { z } from 'zod';

// Workflow Actions
export async function updatePurchaseOrderStatus(orderId: string, newStatus: string): Promise<ActionResult> {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return { success: false, message: 'سفارش یافت نشد' };
    }

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['PENDING_PAYMENT', 'CANCELLED'],
      'PENDING_PAYMENT': ['PAID', 'CANCELLED'],
      'PAID': ['IN_PRODUCTION', 'CANCELLED'],
      'IN_PRODUCTION': ['ARRIVED', 'CANCELLED'],
      'ARRIVED': ['RECEIVED', 'CANCELLED'],
      'RECEIVED': [],
      'CANCELLED': [],
    };

    if (!validTransitions[order.status]?.includes(newStatus)) {
      return { success: false, message: `تغییر وضعیت از ${order.status} به ${newStatus} مجاز نیست` };
    }

    await prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: newStatus }
    });

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    return { success: true, message: 'وضعیت سفارش به‌روزرسانی شد' };
  } catch (error: unknown) {
    console.error('Error updating purchase order status:', error);
    const message = error instanceof Error ? error.message : 'خطا در به‌روزرسانی وضعیت';
    return { success: false, message };
  }
}

export async function recordPurchasePayment(orderId: string, accountId: string): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true, additionalCosts: true }
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status !== 'PENDING_PAYMENT') {
        throw new Error('این سفارش در وضعیت پرداخت نیست');
      }

      // Check account exists and get balance
      const account = await tx.account.findUnique({
        where: { id: accountId }
      });

      if (!account) {
        throw new Error('حساب پرداخت یافت نشد');
      }

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        return rate ? Number(rate.rateToToman) : 1;
      };

      // Calculate total amount in Toman
      let totalInToman = Number(order.totalAmountInToman) || 0;
      if (!totalInToman || totalInToman === 0) {
        // Recalculate if not set
        order.items.forEach((item: any) => {
          const rate = getExchangeRate(item.currency);
          totalInToman += Number(item.quantity) * Number(item.unitCost) * rate;
        });
        if (order.additionalCosts && order.additionalCosts.length > 0) {
          order.additionalCosts.forEach((cost: any) => {
            const rate = getExchangeRate(cost.currency);
            totalInToman += Number(cost.amount) * rate;
          });
        }
      }

      // Check if account has sufficient balance
      const accountBalance = Number(account.balance);
      if (accountBalance < totalInToman) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} تومان، مبلغ مورد نیاز: ${totalInToman.toLocaleString('fa-IR')} تومان`);
      }

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: totalInToman,
          currency: Currency.TOMAN,
          rateSnapshot: 1,
          amountInToman: totalInToman,
          accountId: accountId,
          description: `پرداخت سفارش خرید #${order.number} به تامین‌کننده`,
          category: 'Purchase Payment',
          date: new Date(),
        }
      });

      // Update account balance (decrement)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { decrement: totalInToman }
        }
      });

      // Update order
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paymentAccountId: accountId,
          paymentTransactionId: transaction.id
        }
      });
    });

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/accounting/expenses');
    revalidatePath('/dashboard/accounting/transactions');
    return { success: true, message: 'پرداخت با موفقیت ثبت شد' };
  } catch (error: unknown) {
    console.error('Error recording payment:', error);
    const message = error instanceof Error ? error.message : 'خطا در ثبت پرداخت';
    return { success: false, message };
  }
}

const arrivalCostsSchema = z.array(z.object({
  title: z.string().min(1, 'عنوان الزامی است'),
  amount: z.number().min(0, 'مبلغ باید بیشتر از ۰ باشد'),
  currency: z.enum(['TOMAN', 'USD', 'EUR', 'CNY']),
}));

export async function recordArrival(orderId: string, arrivalCosts: z.infer<typeof arrivalCostsSchema>, accountId: string): Promise<ActionResult> {
  try {
    const validatedCosts = arrivalCostsSchema.parse(arrivalCosts);

    await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId }
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status !== 'IN_PRODUCTION') {
        throw new Error('این سفارش در وضعیت در حال تولید نیست');
      }

      // Check account exists and get balance
      const account = await tx.account.findUnique({
        where: { id: accountId }
      });

      if (!account) {
        throw new Error('حساب پرداخت هزینه‌های رسیدن به مقصد یافت نشد');
      }

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        return rate ? Number(rate.rateToToman) : 1;
      };

      // Create arrival costs and transactions
      const arrivalCostsData = [];
      let totalArrivalCostsInToman = 0;

      // First, calculate total costs to check balance
      for (const cost of validatedCosts) {
        const exchangeRate = getExchangeRate(cost.currency);
        const amountInToman = cost.amount * exchangeRate;
        totalArrivalCostsInToman += amountInToman;
      }

      // Check if account has sufficient balance for all arrival costs
      const accountBalance = Number(account.balance);
      if (accountBalance < totalArrivalCostsInToman) {
        throw new Error(`موجودی حساب "${account.name}" کافی نیست. موجودی: ${accountBalance.toLocaleString('fa-IR')} تومان، مبلغ مورد نیاز: ${totalArrivalCostsInToman.toLocaleString('fa-IR')} تومان`);
      }

      // Now create transactions and arrival costs
      for (const cost of validatedCosts) {
        const exchangeRate = getExchangeRate(cost.currency);
        const amountInToman = cost.amount * exchangeRate;

        // Create transaction for this cost
        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            amount: amountInToman,
            currency: Currency.TOMAN,
            rateSnapshot: exchangeRate,
            amountInToman: amountInToman,
            accountId: accountId,
            description: `هزینه رسیدن به مقصد (${cost.title}) - سفارش خرید #${order.number}`,
            category: 'Purchase Arrival Cost',
            date: new Date(),
          }
        });

        arrivalCostsData.push({
          title: cost.title,
          amount: cost.amount,
          currency: cost.currency,
          exchangeRateSnapshot: exchangeRate,
          amountInToman: amountInToman,
          transactionId: transaction.id,
        });
      }

      // Update account balance (decrement for each cost)
      // Note: We already checked balance above, so we can safely decrement
      if (totalArrivalCostsInToman > 0) {
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: { decrement: totalArrivalCostsInToman }
          }
        });
      }

      // Create arrival costs and update order
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'ARRIVED',
          arrivalAccountId: accountId,
          arrivalAdditionalCosts: {
            create: arrivalCostsData
          }
        }
      });
    });

    revalidatePath('/dashboard/suppliers/orders');
    revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
    revalidatePath('/dashboard/accounting/expenses');
    revalidatePath('/dashboard/accounting/transactions');
    return { success: true, message: 'رسیدن به مقصد و هزینه‌های اضافی ثبت شد' };
  } catch (error: unknown) {
    console.error('Error recording arrival:', error);
    if (error instanceof z.ZodError) {
      return { success: false, message: error.issues[0].message };
    }
    const message = error instanceof Error ? error.message : 'خطا در ثبت رسیدن به مقصد';
    return { success: false, message };
  }
}

