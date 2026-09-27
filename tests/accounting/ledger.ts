import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../helpers/db';
import { sumBalanceEffects } from '@/lib/balance-reconciliation';

/** An account that starts with `opening`, booked as its opening row, so its ledger adds up from the start. */
export async function openAccount(id: string, opening: number, currency = 'TOMAN', extra: Record<string, unknown> = {}) {
  await prisma.account.create({
    data: { id, name: `حساب ${id}`, type: 'BANK', currency: currency as any, balance: opening, ...extra },
  });
  if (opening) {
    await prisma.transaction.create({
      data: {
        type: 'ADJUSTMENT',
        amount: opening,
        amountInToman: opening,
        currency: currency as any,
        accountId: id,
        category: 'موجودی اولیه',
        description: 'موجودی اولیه',
      },
    });
  }
}

export const balanceOf = async (id: string) =>
  Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

/** Stored balance minus the signed sum of the account's rows: 0 while every change was booked with its row. */
export async function driftOf(id: string): Promise<number> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id } });
  const rows = await prisma.transaction.findMany({ where: { accountId: id } });
  return Number(new Decimal(account.balance as any).minus(sumBalanceEffects(rows as any)));
}

/**
 * The invariant after every scenario: each money account's stored balance
 * equals the signed sum of its rows. EXPENSE-type accounts (COGS, depreciation)
 * hold no money and stay at 0 by design, so they are not checked.
 */
export async function assertBooksAddUp() {
  const accounts = await prisma.account.findMany({ where: { type: { not: 'EXPENSE' } } });
  for (const account of accounts) {
    const drift = await driftOf(account.id);
    if (drift !== 0) throw new Error(`${account.name}: balance is ${drift} away from its ledger`);
  }
}
