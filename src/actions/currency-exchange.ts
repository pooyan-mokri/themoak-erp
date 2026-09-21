'use server';

import { prisma } from '@/lib/prisma';
import { Currency, TransactionType } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { checkPermission, getCurrentRole, requirePermission } from '@/lib/access';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
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

  // The two legs of one exchange were written in one database transaction,
  // milliseconds apart, so the closest possible partners are paired first: a
  // leg of another exchange a second away never takes the partner written
  // right beside a leg. loadExchange pairs with this same function over the
  // same rows, so an edit or a delete acts on exactly the pair shown.
  const byTime = [...legacy].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const candidates: Array<[T, T]> = [];
  for (const [index, row] of byTime.entries()) {
    for (const other of byTime.slice(index + 1)) {
      if (other.createdAt.getTime() - row.createdAt.getTime() > LEGACY_PAIR_WINDOW_MS) break;
      if (other.type !== row.type && other.accountId !== row.accountId) candidates.push([row, other]);
    }
  }
  const gap = ([a, b]: [T, T]) => b.createdAt.getTime() - a.createdAt.getTime();
  const taken = new Set<string>();
  const sideOf = (legs: T[]) => ({
    source: legs.find((leg) => leg.type === TransactionType.EXPENSE),
    target: legs.find((leg) => leg.type === TransactionType.INCOME),
  });
  for (const [a, b] of candidates.sort((x, y) => gap(x) - gap(y))) {
    if (taken.has(a.id) || taken.has(b.id)) continue;
    taken.add(a.id);
    taken.add(b.id);
    pairs.push(sideOf([a, b]));
  }
  for (const row of byTime) {
    if (!taken.has(row.id)) pairs.push(sideOf([row]));
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
  if (!groupId) {
    // A leg written before exchangeGroupId existed: its partner is the one the
    // history shows beside it, found the same way from the same rows.
    const anchor = found[0];
    const legacy: ExchangeRow[] = await tx.transaction.findMany({
      where: { category: EXCHANGE_CATEGORY, exchangeGroupId: null },
    });
    const pair = pairExchangeRows(legacy).find((legs) => legs.source?.id === anchor.id || legs.target?.id === anchor.id);
    if (!pair) throw new ExchangeRefusal('این سند معامله ارز هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
    return { ...pair, groupId };
  }

  const legs: ExchangeRow[] = await tx.transaction.findMany({ where: { exchangeGroupId: groupId } });
  return {
    source: legs.find((leg) => leg.type === TransactionType.EXPENSE),
    target: legs.find((leg) => leg.type === TransactionType.INCOME),
    groupId,
  };
}

/**
 * Lock the legs and read them again. A second correction or removal of the same
 * exchange waits here, then sees what the first one left: legs it deleted are
 * gone (refused, so nothing is reversed twice) and legs it rewrote are read
 * with their new amounts.
 */
async function lockLegs(tx: any, pair: ExchangePair): Promise<ExchangePair> {
  const legs = [pair.source, pair.target].filter(Boolean) as ExchangeRow[];
  const ids = legs.map((leg) => leg.id);
  const locked: ExchangeRow[] = await tx.$queryRaw`
    SELECT id, type::text AS type, "accountId", amount FROM "Transaction" WHERE id = ANY(${ids}) FOR UPDATE`;
  if (locked.length !== ids.length) {
    throw new ExchangeRefusal('این سند معامله ارز هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
  }
  const fresh = (leg?: ExchangeRow) => leg && { ...leg, ...locked.find((row) => row.id === leg.id)! };
  return { source: fresh(pair.source), target: fresh(pair.target) };
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
  requestId?: string | null,
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

  const sourceData = {
    ...leg(
      TransactionType.EXPENSE,
      sourceAccountId,
      sourceAmount,
      sourceCurrency,
      sourceAmountInToman,
      `خرید ${targetCurrency} - فروش ${sourceCurrency} - نرخ: ${exchangeRate}`,
    ),
    // The submission's id, on the first row it writes (src/lib/request-id.ts).
    ...(requestId ? { clientRequestId: requestId } : {}),
  };
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

  // Different accounts, different currencies, amounts that agree with the rate.
  const problem = pairingProblem(validatedFields.data);
  if (problem) {
    return { message: problem, errors: {}, success: false };
  }

  const requestId = readRequestId(formData.get('requestId'));

  try {
    if (requestId && (await prisma.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
      return { message: DUPLICATE_REQUEST_MESSAGE, errors: {}, success: true };
    }
    await prisma.$transaction(async (tx: any) => {
      await applyExchange(tx, validatedFields.data, randomUUID(), undefined, requestId);
    });
  } catch (error: any) {
    // The same submission a second time: it was booked once, by the first.
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, errors: {}, success: true };
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

/** How far the Toman amount may be from foreign amount × rate: rounding, not a mis-keyed figure. */
const RATE_TOLERANCE = 0.01;

/** The checks that do not need the database, shared by recording and editing. */
function pairingProblem(input: z.infer<typeof CurrencyExchangeSchema>): string | null {
  if (input.sourceAccountId === input.targetAccountId) return 'حساب مبدا و مقصد نمی‌توانند یکسان باشند.';
  if (input.sourceCurrency === input.targetCurrency) return 'ارز حساب مبدا و مقصد باید متفاوت باشند.';

  // With a Toman side the rate is Toman per 1 unit of the foreign currency, so
  // the two amounts must agree with it: 91 dollars at 90.91 cannot have cost
  // 20,000,000 Toman. One of the three figures was typed wrong.
  const buying = input.sourceCurrency === Currency.TOMAN;
  if (buying || input.targetCurrency === Currency.TOMAN) {
    const toman = buying ? input.sourceAmount : input.targetAmount;
    const foreign = buying ? input.targetAmount : input.sourceAmount;
    const foreignCurrency = buying ? input.targetCurrency : input.sourceCurrency;
    const expected = foreign * input.exchangeRate;
    if (Math.abs(toman - expected) > toman * RATE_TOLERANCE) {
      const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 2 });
      return (
        `مبلغ‌ها با نرخ نمی‌خوانند: ${fa(foreign)} ${foreignCurrency} × ${fa(input.exchangeRate)} = ${fa(expected)} تومان، ` +
        `اما مبلغ تومانی ${fa(toman)} است. نرخ باید تومان به ازای هر ۱ ${foreignCurrency} باشد ` +
        `(با این دو مبلغ: ${fa(toman / foreign)}).`
      );
    }
  }
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
      const found = await loadExchange(tx, input.id);
      const existing = await lockLegs(tx, found);
      await reverseLeg(tx, existing.source);
      await reverseLeg(tx, existing.target);
      await applyExchange(tx, validatedFields.data, found.groupId ?? randomUUID(), existing);
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
      // Locked first: a second delete of the same exchange waits, then finds the
      // legs gone and is refused before it reverses anything.
      const existing = await lockLegs(tx, await loadExchange(tx, id));
      await reverseLeg(tx, existing.source);
      await reverseLeg(tx, existing.target);
      const ids = [existing.source?.id, existing.target?.id].filter(Boolean) as string[];
      const { count } = await tx.transaction.deleteMany({ where: { id: { in: ids } } });
      if (count !== ids.length) {
        throw new ExchangeRefusal('این سند معامله ارز هم‌زمان ویرایش یا حذف شده است؛ صفحه را تازه کنید.');
      }
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
