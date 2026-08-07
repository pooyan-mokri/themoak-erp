'use server';

/**
 * Finding (and repairing) stock that a cancelled sale never returned.
 *
 * The old cancel/delete paths skipped any line whose warehouseId was NULL with
 * `if (!item.warehouseId) continue;`, so those goods were removed from stock at
 * sale time and never credited back. That signature — a CANCELLED order with a
 * NULL warehouse on the line — is exactly what this report looks for.
 *
 * WooCommerce lines are excluded: the Woo importer guards its deduction with
 * the same value, so a NULL warehouse there means the stock was never deducted
 * and nothing is owed back.
 */

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { restoreOrderItemStock, restorableQuantity } from '@/lib/restore-warehouse';
import type { ActionResult } from '@/lib/types';

export type LostStockLine = {
  orderItemId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
};

export type LostStockOrder = {
  orderId: string;
  number: number;
  createdAt: Date;
  customerName: string;
  lines: LostStockLine[];
  totalUnits: number;
};

export async function getUnrestoredCancelledOrders(): Promise<LostStockOrder[]> {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: 'CANCELLED',
        wooId: null, // Woo lines with no warehouse were never deducted
        items: { some: { warehouseId: null } },
      },
      include: {
        customer: { select: { name: true } },
        items: {
          where: { warehouseId: null },
          include: { product: { select: { name: true, sku: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result: LostStockOrder[] = [];

    for (const order of orders) {
      const lines: LostStockLine[] = [];

      for (const item of order.items) {
        // Anything already credited back by a return/exchange is not owed.
        const owed = await restorableQuantity(prisma, item);
        if (owed <= 0) continue;

        lines.push({
          orderItemId: item.id,
          productId: item.productId,
          productName: item.product?.name ?? item.productId,
          sku: item.product?.sku ?? '',
          quantity: owed,
        });
      }

      if (lines.length === 0) continue;

      result.push({
        orderId: order.id,
        number: order.number,
        createdAt: order.createdAt,
        customerName: order.customer?.name ?? 'مشتری عمومی',
        lines,
        totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
      });
    }

    return result;
  } catch (error) {
    console.error('Error finding unrestored cancelled orders:', error);
    return [];
  }
}

/**
 * Credit one cancelled order's missing stock back, using the same resolver the
 * live cancel path uses. Admin only, atomic, and safe to re-run: every repaired
 * line gets its warehouseId stamped, so it drops out of the report and cannot
 * be credited twice.
 */
export async function repairCancelledOrderStock(orderId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند موجودی را ترمیم کند.' };
  }

  try {
    const repaired = await prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: { select: { name: true } } } } },
      });

      if (!order) throw new Error('سفارش یافت نشد.');
      if (order.status !== 'CANCELLED') throw new Error('این سفارش لغو نشده است.');
      if (order.wooId != null) throw new Error('سفارش ووکامرس در زمان فروش از موجودی کسر نشده بود.');

      let count = 0;
      for (const item of order.items) {
        if (item.warehouseId) continue; // already accounted for

        const note = await restoreOrderItemStock(
          tx,
          order,
          item,
          item.product?.name ?? item.productId,
          order.number,
        );
        if (note) continue;

        // Stamp the resolved warehouse so this line can never be repaired twice.
        const movement = await tx.inventoryMovement.findFirst({
          where: { referenceId: order.id, productId: item.productId, type: 'RETURN' },
          orderBy: { createdAt: 'desc' },
        });
        if (movement?.toWarehouseId) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { warehouseId: movement.toWarehouseId },
          });
        }
        count++;
      }

      return count;
    });

    revalidatePath('/dashboard/inventory/lost-stock');
    revalidatePath('/dashboard', 'layout');

    return repaired > 0
      ? { success: true, message: `موجودی ${repaired.toLocaleString('fa-IR')} قلم به انبار بازگشت.` }
      : { success: false, message: 'قلمی برای ترمیم یافت نشد.' };
  } catch (error) {
    console.error('Error repairing cancelled order stock:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در ترمیم موجودی.',
    };
  }
}
