/**
 * Resolving where cancelled/deleted stock goes back to.
 *
 * Cancelling a sale must ALWAYS put the goods back. OrderItem.warehouseId is
 * nullable — the column was added without a backfill (migration
 * 20260505132414), and its foreign key is ON DELETE SET NULL, so deleting a
 * warehouse silently blanks it on historical sales. The old restore loops did
 * `if (!item.warehouseId) continue;`, so those lines were skipped without a
 * word and the stock was lost for good (the order flips to CANCELLED, and the
 * already-cancelled guard then blocks any retry).
 *
 * This module resolves a warehouse through a validated fallback chain and
 * refuses to fail silently: either it returns a warehouse, or it reports a
 * concrete reason, or it throws so the whole transaction rolls back.
 *
 * Deliberately NOT a 'use server' file: it exports plain helpers that run
 * inside the caller's existing prisma transaction.
 */

/** Only physical, live warehouses are valid fallbacks for an ordinary sale. */
const PHYSICAL = { isVirtual: false, isArchived: false } as const;

export type RestoreOrder = {
  id: string;
  customerId: string | null;
  wooId: number | null;
  items: Array<{ id: string; productId: string; warehouseId: string | null }>;
};

export type RestoreItem = {
  id: string;
  productId: string;
  warehouseId: string | null;
  quantity: number;
};

export type RestoreDecision =
  | { restore: true; warehouseId: string; source: string }
  | { restore: false; reason: string };

/**
 * How much of a line is actually still with the customer. Returns and
 * exchanges already credited stock back, so cancelling afterwards must not
 * credit the full quantity again (sell 5, return 2, cancel would give +7).
 */
export async function restorableQuantity(
  tx: any,
  item: { id: string; quantity: number },
): Promise<number> {
  const [returned, exchanged] = await Promise.all([
    tx.orderReturn.aggregate({ where: { orderItemId: item.id }, _sum: { quantity: true } }),
    tx.orderExchange.aggregate({ where: { originalItemId: item.id }, _sum: { quantity: true } }),
  ]);
  return Math.max(
    0,
    item.quantity - (returned._sum.quantity || 0) - (exchanged._sum.quantity || 0),
  );
}

export async function resolveRestoreWarehouse(
  tx: any,
  order: RestoreOrder,
  item: RestoreItem,
  productName: string,
): Promise<RestoreDecision> {
  // 0. The line recorded its own source warehouse — always authoritative.
  //    For a consignment sale this is correctly the partner's virtual warehouse.
  if (item.warehouseId) {
    return { restore: true, warehouseId: item.warehouseId, source: 'ثبت‌شده روی قلم' };
  }

  // 0b. WooCommerce guards its stock deduction with this very same value, so a
  //     NULL warehouse on a Woo order proves nothing was ever deducted.
  //     Crediting it back would invent stock out of nothing.
  if (order.wooId != null) {
    return {
      restore: false,
      reason: `«${productName}»: سفارش ووکامرس بدون انبار ثبت شده بود و هنگام فروش از موجودی کسر نشده؛ موجودی تغییر نکرد.`,
    };
  }

  // 1. Recorded evidence: the SALE movement written for this order.
  const saleMovement = await tx.inventoryMovement.findFirst({
    where: {
      referenceId: order.id,
      productId: item.productId,
      type: 'SALE',
      fromWarehouseId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (saleMovement?.fromWarehouseId) {
    return { restore: true, warehouseId: saleMovement.fromWarehouseId, source: 'گردش انبار' };
  }

  // 2. Consignment sale: the goods belong in the partner's own virtual warehouse.
  if (order.customerId) {
    const partnerWarehouses = await tx.warehouse.findMany({
      where: { customerId: order.customerId, isVirtual: true, isArchived: false },
      orderBy: { createdAt: 'asc' },
    });
    if (partnerWarehouses.length === 1) {
      return { restore: true, warehouseId: partnerWarehouses[0].id, source: 'انبار امانی مشتری' };
    }
    if (partnerWarehouses.length > 1) {
      const holding = await tx.inventory.findFirst({
        where: {
          productId: item.productId,
          warehouseId: { in: partnerWarehouses.map((w: any) => w.id) },
        },
        orderBy: { quantity: 'desc' },
      });
      const chosen = holding?.warehouseId ?? partnerWarehouses[0].id;
      return { restore: true, warehouseId: chosen, source: 'انبار امانی مشتری' };
    }
  }

  // 3. A sibling line on the same order that did record a warehouse — the POS
  //    stamps one warehouse across every line. Re-validated so a partner's
  //    virtual warehouse can't leak into an unrelated customer's sale.
  const siblingId = order.items.find((i) => i.id !== item.id && i.warehouseId)?.warehouseId;
  if (siblingId) {
    const sibling = await tx.warehouse.findUnique({ where: { id: siblingId } });
    const ok = sibling && !sibling.isArchived &&
      (!sibling.isVirtual || sibling.customerId === order.customerId);
    if (ok) {
      return { restore: true, warehouseId: sibling.id, source: 'انبار سایر اقلام همین سفارش' };
    }
  }

  // 4. The configured default warehouse, re-validated as physical and live.
  const setting = await tx.systemSetting.findUnique({ where: { key: 'woo_settings' } });
  let configuredId: string | undefined;
  try {
    configuredId = setting?.value ? JSON.parse(setting.value)?.warehouseId : undefined;
  } catch {
    configuredId = undefined;
  }
  if (configuredId) {
    const configured = await tx.warehouse.findFirst({ where: { id: configuredId, ...PHYSICAL } });
    if (configured) {
      return { restore: true, warehouseId: configured.id, source: 'انبار پیش‌فرض' };
    }
  }
  const byName = await tx.warehouse.findFirst({
    where: { name: { in: ['Main Warehouse', 'انبار اصلی'] }, ...PHYSICAL },
  });
  if (byName) {
    return { restore: true, warehouseId: byName.id, source: 'انبار اصلی' };
  }

  // 5. Wherever this product physically lives today.
  const holding = await tx.inventory.findFirst({
    where: { productId: item.productId, warehouse: { ...PHYSICAL } },
    orderBy: { quantity: 'desc' },
  });
  if (holding?.warehouseId) {
    return { restore: true, warehouseId: holding.warehouseId, source: 'انبار فعلی همین کالا' };
  }

  // 6. Only one physical warehouse exists — unambiguous.
  const physical = await tx.warehouse.findMany({ where: { ...PHYSICAL }, take: 2 });
  if (physical.length === 1) {
    return { restore: true, warehouseId: physical[0].id, source: 'تنها انبار فیزیکی' };
  }

  // 7. Refuse to lose the goods: roll back so the order stays cancellable.
  throw new Error(
    `انبار مقصد برای بازگرداندن «${productName}» قابل تشخیص نیست. لطفا ابتدا انبار پیش‌فرض را در تنظیمات مشخص کنید.`,
  );
}

/**
 * Put a line's stock back and record an auditable movement.
 * Returns a human-readable note when the line was intentionally not credited.
 */
export async function restoreOrderItemStock(
  tx: any,
  order: RestoreOrder,
  item: RestoreItem,
  productName: string,
  orderNumber: number | undefined,
): Promise<string | null> {
  const quantity = await restorableQuantity(tx, item);
  if (quantity <= 0) return null; // already credited back by a return/exchange

  const decision = await resolveRestoreWarehouse(tx, order, item, productName);
  if (!decision.restore) return decision.reason;

  await tx.inventory.upsert({
    where: {
      productId_warehouseId: { productId: item.productId, warehouseId: decision.warehouseId },
    },
    update: { quantity: { increment: quantity } },
    create: { productId: item.productId, warehouseId: decision.warehouseId, quantity },
  });

  await tx.inventoryMovement.create({
    data: {
      productId: item.productId,
      toWarehouseId: decision.warehouseId,
      quantity,
      type: 'RETURN',
      referenceId: order.id,
      note: `بازگشت از لغو سفارش${orderNumber ? ` #${orderNumber}` : ''} — تشخیص انبار: ${decision.source}`,
    },
  });

  return null;
}
