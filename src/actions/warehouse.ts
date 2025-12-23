'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

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

  revalidatePath('/dashboard/inventory/warehouses');
  return { message: 'انبار با موفقیت ثبت شد.' };
}

export async function getWarehouses() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return warehouses;
  } catch (error) {
    throw new Error('Failed to fetch warehouses');
  }
}

export async function getWarehouseById(id: string) {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
    });
    return warehouse;
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

  revalidatePath('/dashboard/inventory/warehouses');
  return { message: 'انبار با موفقیت ویرایش شد.', success: true };
}

export async function deleteWarehouse(id: string) {
  try {
    // Check if warehouse has inventory
    const inventoryCount = await prisma.inventory.count({
      where: { warehouseId: id },
    });

    if (inventoryCount > 0) {
      return { message: 'این انبار دارای موجودی است و قابل حذف نیست.', success: false };
    }

    await prisma.warehouse.delete({
      where: { id },
    });
    
    revalidatePath('/dashboard/inventory/warehouses');
    return { message: 'انبار با موفقیت حذف شد.', success: true };
  } catch (error) {
    return { message: 'خطا در حذف انبار.', success: false };
  }
}
