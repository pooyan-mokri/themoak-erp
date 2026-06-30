'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

// const prisma = new PrismaClient();

const WarehouseSchema = z.object({
  name: z.string().min(1, 'نام انبار الزامی است'),
  isVirtual: z.coerce.boolean().optional(),
});

export async function createWarehouse(prevState: any, formData: FormData) {
  const validatedFields = WarehouseSchema.safeParse({
    name: formData.get('name'),
    isVirtual: formData.get('isVirtual') === 'on',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, isVirtual } = validatedFields.data;

  try {
    await prisma.warehouse.create({
      data: {
        name,
        isVirtual: isVirtual || false,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ثبت انبار.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { message: 'انبار با موفقیت ثبت شد.' };
}

export async function getWarehouses(includeArchived = false) {
  try {
    const warehouses = await prisma.warehouse.findMany({
      // Archived warehouses are hidden from every selector/list by default.
      where: includeArchived ? {} : { isArchived: false },
      orderBy: { createdAt: 'asc' },
    });
    return warehouses.map((w: any) => ({
      ...w,
      customerId: w.customerId ?? undefined,
    }));
  } catch (error) {
    throw new Error('Failed to fetch warehouses');
  }
}

export async function getArchivedWarehouses() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { isArchived: true },
      orderBy: { archivedAt: 'desc' },
    });
    return warehouses.map((w: any) => ({
      ...w,
      customerId: w.customerId ?? undefined,
      archivedAt: w.archivedAt ?? undefined,
    }));
  } catch (error) {
    throw new Error('Failed to fetch archived warehouses');
  }
}

export async function getWarehouseById(id: string) {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
    });
    if (!warehouse) return undefined;
    return {
      ...warehouse,
      customerId: warehouse.customerId ?? undefined,
    };
  } catch (error) {
    throw new Error('Failed to fetch warehouse');
  }
}

export async function updateWarehouse(id: string, prevState: any, formData: FormData) {
  const validatedFields = WarehouseSchema.safeParse({
    name: formData.get('name'),
    isVirtual: formData.get('isVirtual') === 'on',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, isVirtual } = validatedFields.data;

  try {
    await prisma.warehouse.update({
      where: { id },
      data: {
        name,
        isVirtual: isVirtual || false,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ویرایش انبار.',
    };
  }

  revalidatePath('/dashboard', 'layout');
  return { message: 'انبار با موفقیت ویرایش شد.', success: true };
}

export async function deleteWarehouse(id: string) {
  // Admin only
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند انبار را حذف کند.', success: false };
  }

  try {
    // Only allow deletion when the warehouse holds zero stock.
    // We sum quantities (not record count) so a warehouse with leftover
    // zero-quantity inventory rows can still be removed.
    const agg = await prisma.inventory.aggregate({
      where: { warehouseId: id },
      _sum: { quantity: true },
    });
    const totalStock = agg._sum.quantity ?? 0;

    if (totalStock > 0) {
      return { message: `این انبار دارای ${totalStock.toLocaleString('fa-IR')} عدد موجودی است و قابل حذف نیست.`, success: false };
    }

    await prisma.$transaction(async (tx: any) => {
      // Remove the zero-quantity inventory rows first, then the warehouse.
      await tx.inventory.deleteMany({ where: { warehouseId: id } });
      await tx.warehouse.delete({ where: { id } });
    });

    revalidatePath('/dashboard', 'layout');
    return { message: 'انبار با موفقیت حذف شد.', success: true };
  } catch (error: any) {
    // Foreign-key violation: warehouse still referenced by movements / orders / audits
    if (error?.code === 'P2003') {
      return { message: 'این انبار دارای سابقه جابجایی یا فروش است و قابل حذف نیست.', success: false };
    }
    console.error('Error deleting warehouse:', error);
    return { message: 'خطا در حذف انبار.', success: false };
  }
}

/**
 * Archive a warehouse (admin only). Only allowed when the warehouse holds zero
 * stock. Archived warehouses disappear from every selector but remain viewable
 * (with their movement history) and can be restored.
 */
export async function archiveWarehouse(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند انبار را آرشیو کند.', success: false };
  }

  try {
    const agg = await prisma.inventory.aggregate({
      where: { warehouseId: id },
      _sum: { quantity: true },
    });
    const totalStock = agg._sum.quantity ?? 0;
    if (totalStock > 0) {
      return { message: `این انبار دارای ${totalStock.toLocaleString('fa-IR')} عدد موجودی است و قابل آرشیو نیست.`, success: false };
    }

    await prisma.warehouse.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });

    revalidatePath('/dashboard', 'layout');
    return { message: 'انبار با موفقیت آرشیو شد.', success: true };
  } catch (error) {
    console.error('Error archiving warehouse:', error);
    return { message: 'خطا در آرشیو انبار.', success: false };
  }
}

/**
 * Restore an archived warehouse (admin only).
 */
export async function unarchiveWarehouse(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند انبار را بازگرداند.', success: false };
  }

  try {
    await prisma.warehouse.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    revalidatePath('/dashboard', 'layout');
    return { message: 'انبار از آرشیو خارج شد.', success: true };
  } catch (error) {
    console.error('Error unarchiving warehouse:', error);
    return { message: 'خطا در بازگرداندن انبار.', success: false };
  }
}
