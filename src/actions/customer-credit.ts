'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { checkPermission, requirePermission } from '@/lib/access';
import { bookCreditPayment, creditBalance } from '@/lib/sales-records';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';

/** A customer's credit balance («اعتبار»), in Toman. */
export async function getCustomerCredit(customerId: string): Promise<number> {
  await requirePermission('sales.view');
  return creditBalance(prisma, customerId);
}

/**
 * Pay part of an order from its customer's credit: a payment without a cash
 * row, at most the balance and at most what the order still owes. It needs
 * the permission recording a payment needs.
 */
export async function applyCustomerCredit(orderId: string, amount: number, requestId?: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  try {
    const userId = (await auth())?.user?.id ?? null;
    const outcome = await prisma.$transaction((tx: any) =>
      bookCreditPayment(tx, { orderId, amount, requestId: readRequestId(requestId), userId }),
    );
    revalidatePath('/dashboard/sales/history');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    revalidatePath('/dashboard/sales/invoices');
    return {
      success: true,
      message: outcome === 'duplicate' ? DUPLICATE_REQUEST_MESSAGE : 'اعتبار مشتری روی این سفارش اعمال شد.',
    };
  } catch (error: any) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error applying customer credit:', error);
    return { success: false, message: error.message || 'خطا در استفاده از اعتبار مشتری.' };
  }
}
