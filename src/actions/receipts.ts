'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { ACCESS_DENIED_MESSAGE, checkPermission, getCurrentRole } from '@/lib/access';
import { logActivity } from '@/lib/activity-log';
import { INVALID_RECEIPT_MESSAGE, isReceiptRef, mayAttachReceipt } from '@/lib/receipt-ref';
import type { ActionResult } from '@/lib/types';

/**
 * Attach an uploaded receipt (src/actions/upload.ts) to a money row already
 * recorded: a sale, an order payment, a settlement, a deposit, anything.
 * A row that has one keeps it: only an admin replaces a receipt.
 */
export async function attachReceipt(transactionId: string, ref: string): Promise<ActionResult> {
  const denied = await checkPermission(['finance.manage', 'sales.manage']);
  if (denied) return denied;
  if (!isReceiptRef(ref)) return { success: false, message: INVALID_RECEIPT_MESSAGE };

  const role = await getCurrentRole();
  const row = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, type: true, orderId: true, receiptUrl: true, description: true },
  });
  if (!row) return { success: false, message: 'تراکنش یافت نشد.' };
  if (!mayAttachReceipt(role, row)) return { success: false, message: ACCESS_DENIED_MESSAGE };
  if (row.receiptUrl && role !== 'ADMIN') {
    return { success: false, message: 'این تراکنش رسید دارد؛ فقط مدیر سیستم می‌تواند آن را عوض کند.' };
  }
  if (await prisma.transaction.findFirst({ where: { receiptUrl: ref, NOT: { id: row.id } }, select: { id: true } })) {
    return { success: false, message: 'این فایل به تراکنش دیگری وصل است؛ فایل را دوباره آپلود کنید.' };
  }

  // Only if the row still has what was read above: two people attaching at
  // once must not silently replace each other's receipt.
  const { count } = await prisma.transaction.updateMany({
    where: { id: row.id, receiptUrl: row.receiptUrl },
    data: { receiptUrl: ref },
  });
  if (count === 0) {
    return { success: false, message: 'رسید این تراکنش هم‌زمان تغییر کرد؛ صفحه را تازه کنید.' };
  }

  const session = await auth();
  await logActivity(
    session?.user?.id,
    row.receiptUrl ? 'REPLACE_RECEIPT' : 'ATTACH_RECEIPT',
    `رسید ${row.receiptUrl ? 'تعویض' : 'ضمیمه'} شد: ${row.description ?? row.id}`,
  );

  revalidatePath('/dashboard/accounting/transactions');
  if (row.orderId) revalidatePath(`/dashboard/sales/history/${row.orderId}`);
  return { success: true, message: row.receiptUrl ? 'رسید تعویض شد.' : 'رسید ثبت شد.' };
}
