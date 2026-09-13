'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { DEFAULT_SITE_WAREHOUSE_NAME, pickWithDefault, readSiteConnection } from '@/lib/site-connection';

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

/**
 * Why a warehouse cannot be archived or deleted yet, or null.
 * Website sales can drive a row below zero, so a zero sum (+4 of one product,
 * -4 of another) is not an empty warehouse: every row must be zero (leftover
 * zero-quantity rows are fine). The website's own warehouse is refused too,
 * resolved exactly like the site connection settings page shows it.
 */
async function removalBlocker(id: string): Promise<string | null> {
  const nonZero = await prisma.inventory.findFirst({
    where: { warehouseId: id, quantity: { not: 0 } },
    select: { productId: true },
  });
  if (nonZero) {
    return 'این انبار هنوز موجودی غیرصفر (مثبت یا منفی) دارد؛ اول موجودی را صفر یا منتقل کنید.';
  }

  const [connection, warehouses] = await Promise.all([
    readSiteConnection(prisma),
    prisma.warehouse.findMany({
      where: { isArchived: false, isVirtual: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  if (pickWithDefault(warehouses, connection.warehouseId, DEFAULT_SITE_WAREHOUSE_NAME) === id) {
    return 'این انبار، انبار فروش سایت است؛ اول در «تنظیمات › اتصال سایت» انبار دیگری انتخاب کنید.';
  }
  return null;
}

export async function deleteWarehouse(id: string) {
  // Admin only
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند انبار را حذف کند.', success: false };
  }

  try {
    const blocker = await removalBlocker(id);
    if (blocker) {
      return { message: blocker, success: false };
    }

    await prisma.$transaction(async (tx: any) => {
      // Remove the zero-quantity inventory rows first, then the warehouse. A row
      // that turned non-zero since the check is kept and makes the delete fail.
      await tx.inventory.deleteMany({ where: { warehouseId: id, quantity: 0 } });
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
 * Archive a warehouse (admin only). Only allowed when removalBlocker finds nothing.
 * Archived warehouses disappear from every selector but remain viewable
 * (with their movement history) and can be restored.
 */
export async function archiveWarehouse(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند انبار را آرشیو کند.', success: false };
  }

  try {
    const blocker = await removalBlocker(id);
    if (blocker) {
      return { message: blocker, success: false };
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
