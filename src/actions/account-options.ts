'use server';

import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/access';

/**
 * Accounts for a picker (POS, order payment, supplier payment): what a user
 * needs to choose one and print it on an invoice, never the balance. Full
 * account data stays in getAccounts, which needs finance.view.
 */
export async function getAccountOptions() {
  await requirePermission('accounts.pick');
  return prisma.account.findMany({
    select: { id: true, name: true, type: true, currency: true, cardNumber: true, sheba: true },
    orderBy: { createdAt: 'desc' },
  });
}
