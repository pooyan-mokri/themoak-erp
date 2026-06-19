'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// --- Schemas ---

const CurrencyExchangeSchema = z.object({
  sourceAccountId: z.string().min(1, 'حساب مبدا الزامی است'),
  targetAccountId: z.string().min(1, 'حساب مقصد الزامی است'),
  sourceAmount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  targetAmount: z.coerce.number().min(0.01, 'مبلغ باید بیشتر از صفر باشد'),
  sourceCurrency: z.nativeEnum(Currency),
  targetCurrency: z.nativeEnum(Currency),
  exchangeRate: z.coerce.number().min(0.01, 'نرخ تبدیل باید معتبر باشد'),
  date: z.string().optional(),
  description: z.string().optional(),
});

// --- Actions ---

export async function exchangeCurrency(prevState: any, formData: FormData) {
  const validatedFields = CurrencyExchangeSchema.safeParse({
    sourceAccountId: formData.get('sourceAccountId'),
    targetAccountId: formData.get('targetAccountId'),
    sourceAmount: formData.get('sourceAmount'),
    targetAmount: formData.get('targetAmount'),
    sourceCurrency: formData.get('sourceCurrency'),
    targetCurrency: formData.get('targetCurrency'),
    exchangeRate: formData.get('exchangeRate'),
    date: formData.get('date'),
    description: formData.get('description'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const {
    sourceAccountId,
    targetAccountId,
    sourceAmount,
    targetAmount,
    sourceCurrency,
    targetCurrency,
    exchangeRate,
    date,
    description,
  } = validatedFields.data;

  // Validate that accounts are different
  if (sourceAccountId === targetAccountId) {
    return {
      message: 'حساب مبدا و مقصد نمی‌توانند یکسان باشند.',
      errors: {},
      success: false,
    };
  }

  // Validate that currencies match accounts
  if (sourceCurrency === targetCurrency) {
    return {
      message: 'ارز حساب مبدا و مقصد باید متفاوت باشند.',
      errors: {},
      success: false,
    };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get source and target accounts
      const sourceAccount = await tx.account.findUnique({
        where: { id: sourceAccountId },
      });

      const targetAccount = await tx.account.findUnique({
        where: { id: targetAccountId },
      });

      if (!sourceAccount || !targetAccount) {
        throw new Error('حساب یافت نشد.');
      }

      // 2. Validate currency types match accounts
      if (sourceAccount.currency !== sourceCurrency) {
        throw new Error(
          `حساب مبدا باید از نوع ${sourceCurrency} باشد، اما ${sourceAccount.currency} است.`
        );
      }

      if (targetAccount.currency !== targetCurrency) {
        throw new Error(
          `حساب مقصد باید از نوع ${targetCurrency} باشد، اما ${targetAccount.currency} است.`
        );
      }

      // 3. Check sufficient balance in source account
      if (Number(sourceAccount.balance) < sourceAmount) {
        throw new Error(
          `موجودی حساب مبدا کافی نیست. موجودی: ${Number(sourceAccount.balance)}, مبلغ مورد نیاز: ${sourceAmount}`
        );
      }

      // 4. Calculate amounts in Toman for transactions
      // Exchange rate represents: 1 unit of source currency = exchangeRate units of target currency
      let sourceAmountInToman: number;
      let targetAmountInToman: number;

      if (sourceCurrency === Currency.TOMAN) {
        // Buying foreign currency: source is TOMAN, target is foreign
        // exchangeRate = targetAmount / sourceAmount (e.g., 0.024 USD / 1000 TOMAN = 0.000024)
        sourceAmountInToman = sourceAmount;
        // To convert targetAmount (foreign) to TOMAN: targetAmount / exchangeRate = sourceAmount
        targetAmountInToman = sourceAmount; // They should be equal in value
      } else if (targetCurrency === Currency.TOMAN) {
        // Selling foreign currency: source is foreign, target is TOMAN
        // exchangeRate = targetAmount / sourceAmount (e.g., 42000 TOMAN / 1 USD = 42000)
        sourceAmountInToman = sourceAmount * exchangeRate;
        targetAmountInToman = targetAmount;
      } else {
        // Foreign to foreign: need to convert both through TOMAN
        // Get exchange rates for both currencies to TOMAN
        const sourceRate = await tx.exchangeRate.findFirst({
          where: { currency: sourceCurrency },
          orderBy: { date: 'desc' },
        });
        const targetRate = await tx.exchangeRate.findFirst({
          where: { currency: targetCurrency },
          orderBy: { date: 'desc' },
        });
        
        if (!sourceRate || !targetRate) {
          throw new Error('نرخ تبدیل برای ارزهای انتخابی یافت نشد.');
        }
        
        sourceAmountInToman = Number(sourceAmount) * Number(sourceRate.rateToToman);
        targetAmountInToman = Number(targetAmount) * Number(targetRate.rateToToman);
      }

      const transactionDate = date ? new Date(date) : new Date();

      // 5. Create transaction for source account (EXPENSE/OUTGOING)
      const sourceTransaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(sourceAmount),
          currency: sourceCurrency,
          rateSnapshot: new Prisma.Decimal(exchangeRate),
          amountInToman: new Prisma.Decimal(sourceAmountInToman),
          accountId: sourceAccountId,
          description:
            description ||
            `خرید ${targetCurrency} - فروش ${sourceCurrency} - نرخ: ${exchangeRate}`,
          date: transactionDate,
          category: 'Currency Exchange',
        },
      });

      // 6. Create transaction for target account (INCOME/INCOMING)
      const targetTransaction = await tx.transaction.create({
        data: {
          type: TransactionType.INCOME,
          amount: new Prisma.Decimal(targetAmount),
          currency: targetCurrency,
          rateSnapshot: new Prisma.Decimal(exchangeRate),
          amountInToman: new Prisma.Decimal(targetAmountInToman),
          accountId: targetAccountId,
          description:
            description ||
            `فروش ${sourceCurrency} - خرید ${targetCurrency} - نرخ: ${exchangeRate}`,
          date: transactionDate,
          category: 'Currency Exchange',
        },
      });

      // 7. Update source account balance (decrement)
      await tx.account.update({
        where: { id: sourceAccountId },
        data: {
          balance: {
            decrement: new Prisma.Decimal(sourceAmount),
          },
        },
      });

      // 8. Update target account balance (increment)
      await tx.account.update({
        where: { id: targetAccountId },
        data: {
          balance: {
            increment: new Prisma.Decimal(targetAmount),
          },
        },
      });
    });
  } catch (error: any) {
    console.error('Error in currency exchange:', error);
    return {
      message: error.message || 'خطا در انجام معامله ارز.',
      errors: {},
      success: false,
    };
  }

  // Revalidate the whole dashboard so every balance display (accounts,
  // transactions, currency-exchange, dashboard overview) reflects the new
  // balances immediately instead of serving a cached figure.
  revalidatePath('/dashboard', 'layout');
  return { message: 'معامله ارز با موفقیت انجام شد.', success: true };
}

export async function getCurrencyExchangeHistory() {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        category: 'Currency Exchange',
      },
      include: {
        account: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    // Group transactions by date and pair them (source + target)
    const exchanges: Array<{
      id: string;
      date: Date;
      sourceAccount: string;
      targetAccount: string;
      sourceAmount: number;
      targetAmount: number;
      sourceCurrency: Currency;
      targetCurrency: Currency;
      exchangeRate: number;
      description?: string;
    }> = [];

    const processedIds = new Set<string>();

    for (const transaction of transactions) {
      if (processedIds.has(transaction.id)) continue;

      // Find the paired transaction (same date, same category, different account)
      const pairedTransaction = transactions.find(
  (t: any) =>
          t.id !== transaction.id &&
          !processedIds.has(t.id) &&
          t.category === 'Currency Exchange' &&
          t.date.getTime() === transaction.date.getTime() &&
          t.accountId !== transaction.accountId
      );

      if (pairedTransaction && transaction.account && pairedTransaction.account) {
        // Determine which is source and which is target based on transaction type
        const sourceTx =
          transaction.type === TransactionType.EXPENSE
            ? transaction
            : pairedTransaction;
        const targetTx =
          transaction.type === TransactionType.INCOME
            ? transaction
            : pairedTransaction;

        // Additional null check for safety
        if (sourceTx.account && targetTx.account) {
          exchanges.push({
            id: transaction.id,
            date: transaction.date,
            sourceAccount: sourceTx.account.name,
            targetAccount: targetTx.account.name,
            sourceAmount: Number(sourceTx.amount),
            targetAmount: Number(targetTx.amount),
            sourceCurrency: sourceTx.currency,
            targetCurrency: targetTx.currency,
            exchangeRate: Number(sourceTx.rateSnapshot),
            description: sourceTx.description ?? undefined,
          });

          processedIds.add(transaction.id);
          processedIds.add(pairedTransaction.id);
        }
      }
    }

    return exchanges;
  } catch (error) {
    console.error('Error fetching currency exchange history:', error);
    return [];
  }
}

