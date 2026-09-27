'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, hasPermission, requirePermission } from '@/lib/access';

// const prisma = new PrismaClient();

export async function getInventoryByProduct(productId: string) {
  await requirePermission('stock.view');
  try {
    const inventory = await prisma.inventory.findMany({
      where: { productId },
      include: { warehouse: true },
    });
    return inventory.map((inv: any) => ({
      ...inv,
      warehouse: {
        ...inv.warehouse,
        customerId: inv.warehouse.customerId ?? undefined,
      },
    }));
  } catch (error) {
    throw new Error('Failed to fetch inventory');
  }
}

export async function getInventoryByWarehouse(warehouseId: string) {
  await requirePermission('stock.view');
  const [canSeeCost, canSeeSellPrice] = await Promise.all([hasPermission('cost.view'), hasPermission('sales.view')]);
  try {
    const inventory = await prisma.inventory.findMany({
      where: { warehouseId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } }
    });
    return inventory.map((inv: any) => {
      const { costPrice, sellPrice, ...product } = inv.product;
      return {
        ...inv,
        product: {
          ...product,
          ...(canSeeCost && { costPrice: Number(costPrice) }),
          ...(canSeeSellPrice && { sellPrice: Number(sellPrice) }),
          image: inv.product.image ?? undefined,
          wooId: inv.product.wooId ?? undefined,
          barcode: inv.product.barcode ?? undefined,
        },
      };
    });
  } catch (error) {
    throw new Error('Failed to fetch warehouse inventory');
  }
}

// A refusal found inside a transaction: thrown so everything rolls back, then shown to the user as it is.
class StockRefusal extends Error {}

const NOT_WHOLE_UNITS = 'تعداد باید عدد صحیح و بزرگ‌تر از صفر باشد.';

/** Refuses stock into or out of a warehouse that does not exist or is archived (an archived one must stay empty). */
async function assertLiveWarehouses(tx: any, ids: string[]) {
  const found = await tx.warehouse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isArchived: true } });
  for (const id of ids) {
    const warehouse = found.find((w: any) => w.id === id);
    if (!warehouse) throw new StockRefusal('انبار یافت نشد.');
    if (warehouse.isArchived) {
      throw new StockRefusal(`انبار «${warehouse.name}» آرشیو شده است؛ ابتدا آن را از آرشیو خارج کنید.`);
    }
  }
}

/** Takes units out of a row only if it holds them, in one statement, so two takes at once can never both pass. */
async function takeStock(tx: any, productId: string, warehouseId: string, quantity: number): Promise<boolean> {
  const { count } = await tx.inventory.updateMany({
    where: { productId, warehouseId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  return count === 1;
}

/** Sets a row to a counted quantity, booking the difference as an ADJUSTMENT movement. */
export async function updateStock(productId: string, warehouseId: string, quantity: number) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { success: false, error: 'موجودی باید عدد صحیح و بزرگ‌تر یا برابر صفر باشد.' };
  }
  try {
    await prisma.$transaction(async (tx: any) => {
      await assertLiveWarehouses(tx, [warehouseId]);
      // Lock the row (or its absence) so the difference booked is the difference applied.
      const [row] = await tx.$queryRaw`
        SELECT "quantity" FROM "Inventory" WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} FOR UPDATE`;
      const difference = quantity - (row?.quantity ?? 0);
      if (difference === 0) return;
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantity },
        create: { productId, warehouseId, quantity },
      });
      await tx.inventoryMovement.create({
        data: {
          productId,
          fromWarehouseId: difference < 0 ? warehouseId : null,
          toWarehouseId: difference > 0 ? warehouseId : null,
          quantity: Math.abs(difference),
          type: 'ADJUSTMENT',
          note: difference > 0 ? 'افزایش موجودی' : 'کاهش موجودی',
        },
      });
    });
    kickSiteHook();

    revalidatePath('/dashboard/inventory');
    return { success: true };
  } catch (error) {
    if (error instanceof StockRefusal) return { success: false, error: error.message };
    return { success: false, error: 'خطا در ثبت موجودی.' };
  }
}

export async function adjustStock(
  productId: string,
  warehouseId: string,
  adjustment: number,
  note?: string,
  referenceId?: string,
  tags: string[] = [],
) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  if (!Number.isInteger(adjustment) || adjustment === 0) {
    return { success: false, error: 'مقدار تغییر باید عدد صحیح و غیر صفر باشد.' };
  }
  try {
    await prisma.$transaction(async (tx: any) => {
      await assertLiveWarehouses(tx, [warehouseId]);
      if (adjustment > 0) {
        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId, warehouseId } },
          update: { quantity: { increment: adjustment } },
          create: { productId, warehouseId, quantity: adjustment },
        });
      } else if (!(await takeStock(tx, productId, warehouseId, -adjustment))) {
        throw new StockRefusal('موجودی این کالا در انبار برای این کاهش کافی نیست.');
      }

      await tx.inventoryMovement.create({
        data: {
          productId,
          fromWarehouseId: adjustment < 0 ? warehouseId : null,
          toWarehouseId: adjustment >= 0 ? warehouseId : null,
          quantity: Math.abs(adjustment),
          type: 'ADJUSTMENT',
          note: note ?? (adjustment >= 0 ? 'افزایش موجودی' : 'کاهش موجودی'),
          referenceId: referenceId ?? null,
          tags,
        },
      });
    });
    kickSiteHook();

    revalidatePath('/dashboard/inventory');
    return { success: true, message: 'موجودی با موفقیت تنظیم شد.' };
  } catch (error) {
    if (error instanceof StockRefusal) return { success: false, error: error.message };
    console.error('Error adjusting stock:', error);
    return { success: false, error: 'خطا در تنظیم موجودی.' };
  }
}

export async function transferStock(
  productId: string,
  fromWarehouseId: string,
  toWarehouseId: string,
  quantity: number,
  note?: string,
  referenceId?: string,
  tags: string[] = [],
) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  if (!Number.isInteger(quantity) || quantity <= 0) return { success: false, error: NOT_WHOLE_UNITS };
  if (fromWarehouseId === toWarehouseId) {
    return { success: false, error: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند' };
  }
  try {
    await prisma.$transaction(async (tx: any) => {
      await assertLiveWarehouses(tx, [fromWarehouseId, toWarehouseId]);

      // 1. Decrement source, only if it holds enough
      if (!(await takeStock(tx, productId, fromWarehouseId, quantity))) {
        throw new StockRefusal('موجودی انبار مبدا کافی نیست');
      }

      // 2. Increment target
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        update: { quantity: { increment: quantity } },
        create: { productId, warehouseId: toWarehouseId, quantity },
      });

      // 3. Record movement
      await tx.inventoryMovement.create({
        data: {
          productId,
          fromWarehouseId,
          toWarehouseId,
          quantity,
          type: 'TRANSFER',
          note: note ?? null,
          referenceId: referenceId ?? null,
          tags,
        },
      });
    });
    kickSiteHook();

    revalidatePath('/dashboard/inventory');
    return { success: true, message: 'جابجایی موجودی با موفقیت انجام شد' };
  } catch (error: any) {
    if (error instanceof StockRefusal) return { success: false, error: error.message };
    console.error('Error transferring stock:', error);
    return { success: false, error: 'خطا در جابجایی موجودی' };
  }
}

/**
 * Transfer several products between two warehouses in a single atomic operation.
 * Either every line moves or none does.
 */
export async function transferStockBatch(input: {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: Array<{ productId: string; quantity: number }>;
  tags?: string[];
  note?: string;
}) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  const { fromWarehouseId, toWarehouseId, items, tags = [], note } = input;

  if (!fromWarehouseId || !toWarehouseId) {
    return { success: false, error: 'انبار مبدا و مقصد را انتخاب کنید' };
  }
  if (fromWarehouseId === toWarehouseId) {
    return { success: false, error: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند' };
  }
  const validItems = items.filter((i) => i.productId && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: 'حداقل یک کالا به لیست اضافه کنید' };
  }
  if (validItems.some((i) => !Number.isInteger(i.quantity))) return { success: false, error: NOT_WHOLE_UNITS };

  try {
    await prisma.$transaction(async (tx: any) => {
      await assertLiveWarehouses(tx, [fromWarehouseId, toWarehouseId]);
      for (const item of validItems) {
        if (!(await takeStock(tx, item.productId, fromWarehouseId, item.quantity))) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new StockRefusal(`موجودی انبار مبدا برای «${product?.name ?? item.productId}» کافی نیست`);
        }

        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: toWarehouseId } },
          update: { quantity: { increment: item.quantity } },
          create: { productId: item.productId, warehouseId: toWarehouseId, quantity: item.quantity },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            fromWarehouseId,
            toWarehouseId,
            quantity: item.quantity,
            type: 'TRANSFER',
            note: note ?? null,
            tags,
          },
        });
      }
    });
    kickSiteHook();

    revalidatePath('/dashboard/inventory');
    return { success: true, message: `جابجایی ${validItems.length} کالا با موفقیت انجام شد` };
  } catch (error: any) {
    if (error instanceof StockRefusal) return { success: false, error: error.message };
    console.error('Error in batch transfer:', error);
    return { success: false, error: 'خطا در جابجایی موجودی' };
  }
}

export async function getWarehouseDashboardStats() {
  await requirePermission('stock.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const [
      totalWarehouses,
      totalProducts,
      lowStockItems,
      totalInventoryValue
    ] = await Promise.all([
      // Archived warehouses are hidden from every list, so the count leaves them out too.
      prisma.warehouse.count({ where: { isArchived: false } }),
      prisma.product.count(),
      prisma.inventory.count({
        where: { quantity: { lte: 10 } } // Assuming 10 is low stock threshold
      }),
      // Stock value is quantity × cost: only loaded for roles that may see cost.
      canSeeCost
        ? prisma.inventory.findMany({
            include: { product: true }
          })
        : [],
    ]);

    const totalValue = canSeeCost
      ? totalInventoryValue.reduce((sum: any, item: any) => {
          return sum + (item.quantity * Number(item.product.costPrice || 0));
        }, 0)
      : null;

    return {
      totalWarehouses,
      totalProducts,
      lowStockItems,
      totalValue
    };
  } catch (error) {
    console.error('Error fetching warehouse stats:', error);
    return {
      totalWarehouses: 0,
      totalProducts: 0,
      lowStockItems: 0,
      totalValue: canSeeCost ? 0 : null
    };
  }
}
