'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { checkPermission, getCurrentRole, requirePermission } from '@/lib/access';
import { randomUUID } from 'node:crypto';

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

const EXCHANGE_CATEGORY = 'Currency Exchange';

/**
 * One exchange is two transactions: the money leaving the source account and the
 * money arriving in the target one. Both legs carry the same exchangeGroupId.
 *
 * Exchanges recorded before that column existed have none, so they are paired by
 * creation time: the two legs are written in one database transaction, a
 * millisecond apart. The old code paired them by `date`, which the form stores
 * without a time, so two exchanges on the same day could be shown mixed up.
 */
const LEGACY_PAIR_WINDOW_MS = 5000;

type ExchangeRow = {
  id: string;
  type: string;
  accountId: string | null;
  amount: unknown;
  currency: Currency;
  rateSnapshot: unknown;
  date: Date;
  createdAt: Date;
  description: string | null;
  exchangeGroupId: string | null;
};

type ExchangePair = { source?: ExchangeRow; target?: ExchangeRow };

/** Groups exchange rows into pairs, newest first. A leg without a partner is returned alone. */
function pairExchangeRows<T extends ExchangeRow>(rows: T[]): Array<{ source?: T; target?: T }> {
  const byGroup = new Map<string, { source?: T; target?: T }>();
  const legacy: T[] = [];
  const pairs: Array<{ source?: T; target?: T }> = [];

  for (const row of rows) {
    if (!row.exchangeGroupId) {
      legacy.push(row);
      continue;
    }
    let pair = byGroup.get(row.exchangeGroupId);
    if (!pair) {
      pair = {};
      byGroup.set(row.exchangeGroupId, pair);
      pairs.push(pair);
    }
    if (row.type === TransactionType.EXPENSE) pair.source = row;
    else pair.target = row;
  }

  // Oldest first, so each leg meets the partner written beside it.
  const unpaired = [...legacy].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const taken = new Set<string>();
  for (const [index, row] of unpaired.entries()) {
    if (taken.has(row.id)) continue;
    const partner = unpaired
      .slice(index + 1)
      .find(
        (other) =>
          !taken.has(other.id) &&
          other.type !== row.type &&
          other.accountId !== row.accountId &&
          other.createdAt.getTime() - row.createdAt.getTime() <= LEGACY_PAIR_WINDOW_MS,
      );
    taken.add(row.id);
    if (partner) taken.add(partner.id);
    const legs = [row, partner].filter(Boolean) as T[];
    pairs.push({
      source: legs.find((leg) => leg.type === TransactionType.EXPENSE),
      target: legs.find((leg) => leg.type === TransactionType.INCOME),
    });
  }

  const at = (pair: { source?: T; target?: T }) => (pair.source ?? pair.target)!.date.getTime();
  return pairs.sort((a, b) => at(b) - at(a));
}

/** A refusal meant for the user, not a crash. */
class ExchangeRefusal extends Error {}

/** The legs of the exchange `id` names, which is either a group id or one leg's id. */
async function loadExchange(tx: any, id: string): Promise<ExchangePair & { groupId: string | null }> {
  const found = await tx.transaction.findMany({
    where: { category: EXCHANGE_CATEGORY, OR: [{ exchangeGroupId: id }, { id }] },
  });
  if (found.length === 0) throw new ExchangeRefusal('سند معامله ارز یافت نشد.');

  const groupId: string | null = found[0].exchangeGroupId ?? null;
  let legs: ExchangeRow[] = found;
  if (groupId) {
    legs = await tx.transaction.findMany({ where: { exchangeGroupId: groupId } });
  } else {
    // A leg written before exchangeGroupId existed: take the nearest opposite leg beside it.
    const anchor = legs[0];
    const near: ExchangeRow[] = await tx.transaction.findMany({
      where: {
        category: EXCHANGE_CATEGORY,
        exchangeGroupId: null,
        id: { not: anchor.id },
        type: anchor.type === TransactionType.EXPENSE ? TransactionType.INCOME : TransactionType.EXPENSE,
        createdAt: {
          gte: new Date(anchor.createdAt.getTime() - LEGACY_PAIR_WINDOW_MS),
          lte: new Date(anchor.createdAt.getTime() + LEGACY_PAIR_WINDOW_MS),
        },
      },
    });
    const apart = (row: ExchangeRow) => Math.abs(row.createdAt.getTime() - anchor.createdAt.getTime());
    const partner = near
      .filter((row) => row.accountId !== anchor.accountId)
      .sort((a, b) => apart(a) - apart(b))[0];
    legs = partner ? [anchor, partner] : [anchor];
  }

  return {
    source: legs.find((leg) => leg.type === TransactionType.EXPENSE),
    target: legs.find((leg) => leg.type === TransactionType.INCOME),
    groupId,
  };
}

/** Undo what a leg did to its account's balance. */
async function reverseLeg(tx: any, leg?: ExchangeRow) {
  if (!leg?.accountId) return;
  const amount = new Prisma.Decimal(leg.amount as any);
  await tx.account.update({
    where: { id: leg.accountId },
    data: leg.type === TransactionType.EXPENSE ? { balance: { increment: amount } } : { balance: { decrement: amount } },
  });
}

/** Editing or deleting a recorded exchange stays with the admin, like a recorded expense. */
async function requireAdmin(): Promise<{ success: false; message: string; errors: {} } | null> {
  if ((await getCurrentRole()) !== 'ADMIN') {
    return {
      success: false,
      message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند سند معامله ارز را ویرایش یا حذف کند.',
      errors: {},
    };
  }
  return null;
}

/**
 * Writes one exchange: the two legs and the two balances, inside `tx`.
 * With `existing`, the legs of that exchange are rewritten instead of created,
 * so an edit keeps the same documents. The caller reverses the old balances first.
 */
async function applyExchange(
  tx: any,
  input: z.infer<typeof CurrencyExchangeSchema>,
  groupId: string,
  existing?: ExchangePair,
) {
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
  } = input;

  const sourceAccount = await tx.account.findUnique({ where: { id: sourceAccountId } });
  const targetAccount = await tx.account.findUnique({ where: { id: targetAccountId } });
  if (!sourceAccount || !targetAccount) {
    throw new ExchangeRefusal('حساب یافت نشد.');
  }
  if (sourceAccount.currency !== sourceCurrency) {
    throw new ExchangeRefusal(`حساب مبدا باید از نوع ${sourceCurrency} باشد، اما ${sourceAccount.currency} است.`);
  }
  if (targetAccount.currency !== targetCurrency) {
    throw new ExchangeRefusal(`حساب مقصد باید از نوع ${targetCurrency} باشد، اما ${targetAccount.currency} است.`);
  }
  if (Number(sourceAccount.balance) < sourceAmount) {
    throw new ExchangeRefusal(
      `موجودی حساب مبدا کافی نیست. موجودی: ${Number(sourceAccount.balance)}, مبلغ مورد نیاز: ${sourceAmount}`,
    );
  }

  // Both legs in Toman, for reports that add different currencies together.
  let sourceAmountInToman: number;
  let targetAmountInToman: number;
  if (sourceCurrency === Currency.TOMAN) {
    // Buying foreign currency: the Toman side is the value of both legs.
    sourceAmountInToman = sourceAmount;
    targetAmountInToman = sourceAmount;
  } else if (targetCurrency === Currency.TOMAN) {
    // Selling foreign currency: the rate is Toman per unit.
    sourceAmountInToman = sourceAmount * exchangeRate;
    targetAmountInToman = targetAmount;
  } else {
    // Foreign to foreign: value each leg with its own stored rate.
    const sourceRate = await tx.exchangeRate.findFirst({ where: { currency: sourceCurrency }, orderBy: { date: 'desc' } });
    const targetRate = await tx.exchangeRate.findFirst({ where: { currency: targetCurrency }, orderBy: { date: 'desc' } });
    if (!sourceRate || !targetRate) {
      throw new ExchangeRefusal('نرخ تبدیل برای ارزهای انتخابی یافت نشد.');
    }
    sourceAmountInToman = Number(sourceAmount) * Number(sourceRate.rateToToman);
    targetAmountInToman = Number(targetAmount) * Number(targetRate.rateToToman);
  }

  const transactionDate = date ? new Date(date) : new Date();
  const leg = (
    type: TransactionType,
    accountId: string,
    amount: number,
    currency: Currency,
    amountInToman: number,
    fallbackDescription: string,
  ) => ({
    type,
    accountId,
    amount: new Prisma.Decimal(amount),
    currency,
    rateSnapshot: new Prisma.Decimal(exchangeRate),
    amountInToman: new Prisma.Decimal(amountInToman),
    description: description || fallbackDescription,
    date: transactionDate,
    category: EXCHANGE_CATEGORY,
    exchangeGroupId: groupId,
  });

  const sourceData = leg(
    TransactionType.EXPENSE,
    sourceAccountId,
    sourceAmount,
    sourceCurrency,
    sourceAmountInToman,
    `خرید ${targetCurrency} - فروش ${sourceCurrency} - نرخ: ${exchangeRate}`,
  );
  const targetData = leg(
    TransactionType.INCOME,
    targetAccountId,
    targetAmount,
    targetCurrency,
    targetAmountInToman,
    `فروش ${sourceCurrency} - خرید ${targetCurrency} - نرخ: ${exchangeRate}`,
  );

  for (const [data, old] of [
    [sourceData, existing?.source],
    [targetData, existing?.target],
  ] as const) {
    if (old) await tx.transaction.update({ where: { id: old.id }, data });
    else await tx.transaction.create({ data });
  }

  await tx.account.update({
    where: { id: sourceAccountId },
    data: { balance: { decrement: new Prisma.Decimal(sourceAmount) } },
  });
  await tx.account.update({
    where: { id: targetAccountId },
    data: { balance: { increment: new Prisma.Decimal(targetAmount) } },
  });
}

// --- Actions ---

export async function exchangeCurrency(prevState: any, formData: FormData) {
  const denied = await checkPermission('finance.manage');
  if (denied) return { ...denied, errors: {} };

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
      await applyExchange(tx, validatedFields.data, randomUUID());
    });
  } catch (error: any) {
    console.error('Error in currency exchange:', error);
    return {
      message: error instanceof ExchangeRefusal ? error.message : 'خطا در انجام معامله ارز.',
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

/** The checks that do not need the database, shared by recording and editing. */
function pairingProblem(input: z.infer<typeof CurrencyExchangeSchema>): string | null {
  if (input.sourceAccountId === input.targetAccountId) return 'حساب مبدا و مقصد نمی‌توانند یکسان باشند.';
  if (input.sourceCurrency === input.targetCurrency) return 'ارز حساب مبدا و مقصد باید متفاوت باشند.';
  return null;
}

/**
 * Correct a recorded exchange. The old amounts are taken back off both accounts
 * and the new ones applied, in one transaction, so the balances end up as if the
 * exchange had been recorded this way in the first place.
 */
export async function updateCurrencyExchange(input: {
  id: string;
  sourceAccountId: string;
  targetAccountId: string;
  sourceAmount: number;
  targetAmount: number;
  sourceCurrency: Currency;
  targetCurrency: Currency;
  exchangeRate: number;
  date?: string;
  description?: string;
}): Promise<{ success: boolean; message: string }> {
  const denied = await requireAdmin();
  if (denied) return { success: false, message: denied.message };

  const validatedFields = CurrencyExchangeSchema.safeParse(input);
  if (!validatedFields.success) {
    const first = Object.values(validatedFields.error.flatten().fieldErrors)[0]?.[0];
    return { success: false, message: first ?? 'لطفا فیلدهای الزامی را پر کنید.' };
  }

  const problem = pairingProblem(validatedFields.data);
  if (problem) return { success: false, message: problem };

  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await loadExchange(tx, input.id);
      await reverseLeg(tx, existing.source);
      await reverseLeg(tx, existing.target);
      await applyExchange(tx, validatedFields.data, existing.groupId ?? randomUUID(), existing);
    });
  } catch (error: unknown) {
    console.error('Error editing currency exchange:', error);
    return {
      success: false,
      message: error instanceof ExchangeRefusal ? error.message : 'خطا در ویرایش معامله ارز.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: true, message: 'سند معامله ارز اصلاح شد و موجودی حساب‌ها به‌روز شد.' };
}

/** Remove a recorded exchange and give both accounts their money back. */
export async function deleteCurrencyExchange(id: string) {
  const denied = await requireAdmin();
  if (denied) return { success: false, message: denied.message };

  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await loadExchange(tx, id);
      await reverseLeg(tx, existing.source);
      await reverseLeg(tx, existing.target);
      const ids = [existing.source?.id, existing.target?.id].filter(Boolean) as string[];
      await tx.transaction.deleteMany({ where: { id: { in: ids } } });
    });
  } catch (error: any) {
    console.error('Error deleting currency exchange:', error);
    return {
      success: false,
      message: error instanceof ExchangeRefusal ? error.message : 'خطا در حذف معامله ارز.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: true, message: 'سند معامله ارز حذف شد و موجودی حساب‌ها به حالت قبل برگشت.' };
}

export type ExchangeHistoryRow = {
  /** What edit and delete take: the exchange's group id, or the id of its only leg. */
  id: string;
  date: Date;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  sourceAccount: string | null;
  targetAccount: string | null;
  sourceAmount: number | null;
  targetAmount: number | null;
  sourceCurrency: Currency | null;
  targetCurrency: Currency | null;
  exchangeRate: number;
  description?: string;
  /** False when only one leg of the exchange is in the books. */
  complete: boolean;
};

export async function getCurrencyExchangeHistory(): Promise<ExchangeHistoryRow[]> {
  await requirePermission('finance.view');
  try {
    const rows = await prisma.transaction.findMany({
      where: { category: EXCHANGE_CATEGORY },
      include: { account: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });

    return pairExchangeRows(rows as any).map((pair) => {
      const { source, target } = pair as { source?: any; target?: any };
      const known = (source ?? target)!;
      return {
        id: known.exchangeGroupId ?? known.id,
        date: known.date,
        sourceAccountId: source?.accountId ?? null,
        targetAccountId: target?.accountId ?? null,
        sourceAccount: source?.account?.name ?? null,
        targetAccount: target?.account?.name ?? null,
        sourceAmount: source ? Number(source.amount) : null,
        targetAmount: target ? Number(target.amount) : null,
        sourceCurrency: source?.currency ?? null,
        targetCurrency: target?.currency ?? null,
        exchangeRate: Number(known.rateSnapshot),
        description: known.description ?? undefined,
        complete: Boolean(source && target),
      };
    });
  } catch (error) {
    console.error('Error fetching currency exchange history:', error);
    return [];
  }
}
