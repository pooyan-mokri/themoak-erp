'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

export async function getInventoryByProduct(productId: string) {
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
  try {
    const inventory = await prisma.inventory.findMany({
      where: { warehouseId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } }
    });
    return inventory.map((inv: any) => ({
      ...inv,
      product: {
        ...inv.product,
        costPrice: Number(inv.product.costPrice),
        sellPrice: Number(inv.product.sellPrice),
        image: inv.product.image ?? undefined,
        wooId: inv.product.wooId ?? undefined,
        barcode: inv.product.barcode ?? undefined,
      },
    }));
  } catch (error) {
    throw new Error('Failed to fetch warehouse inventory');
  }
}

export async function updateStock(productId: string, warehouseId: string, quantity: number) {
  try {
    await prisma.inventory.upsert({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
      update: {
        quantity,
      },
      create: {
        productId,
        warehouseId,
        quantity,
      },
    });

    // Update stock in WooCommerce if this is the WooCommerce warehouse
    const { updateProductStockInWooCommerce } = await import('./woocommerce');
    const wooResult = await updateProductStockInWooCommerce(productId, warehouseId, quantity);

    if (wooResult.success && wooResult.data?.updated) {
      console.log(`[Inventory Update] موجودی در WooCommerce هم به‌روزرسانی شد`);
    }

    revalidatePath('/dashboard/inventory');
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to update stock' };
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
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantity: { increment: adjustment } },
        create: { productId, warehouseId, quantity: adjustment },
      });

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

    revalidatePath('/dashboard/inventory');
    return { success: true, message: 'Stock adjusted successfully' };
  } catch (error) {
    console.error('Error adjusting stock:', error);
    return { success: false, error: 'Failed to adjust stock' };
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
  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Check source stock
      const sourceStock = await tx.inventory.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
      });

      if (!sourceStock || sourceStock.quantity < quantity) {
        throw new Error('موجودی انبار مبدا کافی نیست');
      }

      // 2. Decrement source
      await tx.inventory.update({
        where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
        data: { quantity: { decrement: quantity } },
      });

      // 3. Increment target
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        update: { quantity: { increment: quantity } },
        create: { productId, warehouseId: toWarehouseId, quantity },
      });

      // 4. Record movement
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

    revalidatePath('/dashboard/inventory');
    return { success: true, message: 'جابجایی موجودی با موفقیت انجام شد' };
  } catch (error: any) {
    console.error('Error transferring stock:', error);
    return { success: false, error: error.message || 'Failed to transfer stock' };
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

  try {
    await prisma.$transaction(async (tx: any) => {
      for (const item of validItems) {
        const sourceStock = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: fromWarehouseId } },
        });

        if (!sourceStock || sourceStock.quantity < item.quantity) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new Error(`موجودی انبار مبدا برای «${product?.name ?? item.productId}» کافی نیست`);
        }

        await tx.inventory.update({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: fromWarehouseId } },
          data: { quantity: { decrement: item.quantity } },
        });

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

    revalidatePath('/dashboard/inventory');
    return { success: true, message: `جابجایی ${validItems.length} کالا با موفقیت انجام شد` };
  } catch (error: any) {
    console.error('Error in batch transfer:', error);
    return { success: false, error: error.message || 'خطا در جابجایی موجودی' };
  }
}

export async function getWarehouseDashboardStats() {
  try {
    const [
      totalWarehouses,
      totalProducts,
      lowStockItems,
      totalInventoryValue
    ] = await Promise.all([
      prisma.warehouse.count(),
      prisma.product.count(),
      prisma.inventory.count({
        where: { quantity: { lte: 10 } } // Assuming 10 is low stock threshold
      }),
      prisma.inventory.findMany({
        include: { product: true }
      })
    ]);

    const totalValue = totalInventoryValue.reduce((sum: any, item: any) => {
      return sum + (item.quantity * Number(item.product.costPrice || 0));
    }, 0);

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
      totalValue: 0
    };
  }
}
