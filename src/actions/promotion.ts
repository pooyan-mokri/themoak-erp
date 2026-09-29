'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, requirePermission } from '@/lib/access';
import { percentDiscount } from '@/lib/discount';
import { WarehouseUnderAudit, assertNoOpenAudit } from '@/lib/audit-stock-lock';

// const prisma = new PrismaClient();

const PromotionSchema = z.object({
  name: z.string().min(1, 'نام کمپین ال زامی است'),
  type: z.enum(['DISCOUNT', 'GIFT', 'VOUCHER']),
  description: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  productId: z.string().optional(), // For GIFT type
  discountPercent: z.number().min(0).max(100).optional(), // For DISCOUNT type
  discountAmount: z.number().min(0).optional(), // For fixed discount
  minPurchase: z.number().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
});

/**
 * A day from the form's date field (YYYY-MM-DD) as the moment it starts, or
 * ends, in Tehran (+03:30, no daylight saving): a promotion runs through its
 * whole last day. Anything else is read as a date as it is.
 */
function tehranDayBound(value: string, end: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+03:30`);
  }
  return new Date(value);
}

export async function createPromotion(prevState: any, formData: FormData) {
  const denied = await checkPermission('sales.manage');
  if (denied) return { message: denied.message };
  const validatedFields = PromotionSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    description: formData.get('description'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    productId: formData.get('productId') || undefined,
    discountPercent: formData.get('discountPercent') ? Number(formData.get('discountPercent')) : undefined,
    discountAmount: formData.get('discountAmount') ? Number(formData.get('discountAmount')) : undefined,
    minPurchase: formData.get('minPurchase') ? Number(formData.get('minPurchase')) : undefined,
    maxUses: formData.get('maxUses') ? Number(formData.get('maxUses')) : undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, type, description, startDate, endDate, productId, discountPercent, discountAmount, minPurchase, maxUses } = validatedFields.data;
  const start = tehranDayBound(startDate, false);
  const end = tehranDayBound(endDate, true);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { message: 'تاریخ کمپین نامعتبر است.' };
  }
  if (end < start) {
    return { message: 'تاریخ پایان کمپین نباید پیش از تاریخ شروع باشد.' };
  }

  try {
    await prisma.promotion.create({
      data: {
        name,
        type,
        description,
        startDate: start,
        endDate: end,
        productId,
        discountPercent,
        discountAmount,
        minPurchase,
        maxUses,
      },
    });

    revalidatePath('/dashboard/crm/promotions');
    return { message: 'کمپین تبلیغاتی با موفقیت ایجاد شد.', success: true };
  } catch (error) {
    console.error('Error creating promotion:', error);
    return { message: 'خطا در ایجاد کمپین تبلیغاتی.' };
  }
}

export async function getPromotions() {
  await requirePermission('sales.view');
  try {
    const promotions = await prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Serialize Decimal fields to numbers
    return promotions.map((promotion: any) => ({
      ...promotion,
      description: promotion.description ?? undefined,
      productId: promotion.productId ?? undefined,
      discountPercent: promotion.discountPercent ? Number(promotion.discountPercent) : undefined,
      discountAmount: promotion.discountAmount ? Number(promotion.discountAmount) : undefined,
      minPurchase: promotion.minPurchase ? Number(promotion.minPurchase) : undefined,
      maxUses: promotion.maxUses ? Number(promotion.maxUses) : undefined,
    }));
  } catch (error) {
    console.error('Error fetching promotions:', error);
    return [];
  }
}

export async function getActivePromotions() {
  await requirePermission('sales.view');
  try {
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        OR: [
          { maxUses: null },
          {
            maxUses: {
              gt: prisma.promotion.fields.usedCount
            }
          }
        ]
      },
      orderBy: { createdAt: 'desc' },
    });

    return promotions.map((promotion: any) => ({
      ...promotion,
      description: promotion.description ?? undefined,
      productId: promotion.productId ?? undefined,
      discountPercent: promotion.discountPercent ? Number(promotion.discountPercent) : undefined,
      discountAmount: promotion.discountAmount ? Number(promotion.discountAmount) : undefined,
      minPurchase: promotion.minPurchase ? Number(promotion.minPurchase) : undefined,
      maxUses: promotion.maxUses ? Number(promotion.maxUses) : undefined,
    }));
  } catch (error) {
    console.error('Error fetching active promotions:', error);
    return [];
  }
}

export async function getPromotionById(id: string) {
  await requirePermission('sales.view');
  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion) return undefined;

    return {
      ...promotion,
      description: promotion.description ?? undefined,
      productId: promotion.productId ?? undefined,
      discountPercent: promotion.discountPercent ? Number(promotion.discountPercent) : undefined,
      discountAmount: promotion.discountAmount ? Number(promotion.discountAmount) : undefined,
      minPurchase: promotion.minPurchase ? Number(promotion.minPurchase) : undefined,
      maxUses: promotion.maxUses ? Number(promotion.maxUses) : undefined,
    };
  } catch (error) {
    console.error('Error fetching promotion:', error);
    return undefined;
  }
}

export async function applyPromotion(promotionId: string, orderTotal: number) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  if (!(orderTotal >= 0)) return { success: false, message: 'مبلغ سفارش نامعتبر است.' };
  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id: promotionId },
    });

    if (!promotion) {
      return { success: false, message: 'کمپین یافت نشد.' };
    }

    // Check if promotion is active
    const now = new Date();
    if (!promotion.isActive || promotion.startDate > now || promotion.endDate < now) {
      return { success: false, message: 'این کمپین فعال نیست.' };
    }

    // Check max uses
    if (promotion.maxUses && promotion.usedCount >= promotion.maxUses) {
      return { success: false, message: 'این کمپین به حداکثر استفاده رسیده است.' };
    }

    // Check minimum purchase
    if (promotion.minPurchase && orderTotal < Number(promotion.minPurchase)) {
      return { 
        success: false, 
        message: `حداقل مبلغ خرید برای این کمپین ${Number(promotion.minPurchase).toLocaleString('fa-IR')} تومان است.` 
      };
    }

    // Calculate discount
    let discountAmount = 0;
    if (promotion.type === 'DISCOUNT') {
      if (promotion.discountPercent) {
        discountAmount = percentDiscount(orderTotal, Number(promotion.discountPercent));
      } else if (promotion.discountAmount) {
        discountAmount = Number(promotion.discountAmount);
      }
    }
    // A discount never takes more than the order is worth.
    discountAmount = Math.min(discountAmount, orderTotal);

    return {
      success: true,
      discountAmount,
      giftProductId: promotion.type === 'GIFT' ? promotion.productId : undefined,
      promotionName: promotion.name,
    };
  } catch (error) {
    console.error('Error applying promotion:', error);
    return { success: false, message: 'خطا در اعمال کمپین.' };
  }
}

export async function incrementPromotionUsage(promotionId: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  try {
    // Counted only while uses are left, in the same update: two sales at the
    // same moment cannot take the last use twice.
    const bumped = await prisma.promotion.updateMany({
      where: {
        id: promotionId,
        OR: [{ maxUses: null }, { maxUses: { gt: prisma.promotion.fields.usedCount } }],
      },
      data: {
        usedCount: {
          increment: 1
        }
      }
    });
    if (bumped.count === 0) {
      const exists = await prisma.promotion.count({ where: { id: promotionId } });
      return { success: false, message: exists ? 'این کمپین به حداکثر استفاده رسیده است.' : 'کمپین یافت نشد.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error incrementing promotion usage:', error);
    return { success: false };
  }
}

export async function deactivatePromotion(id: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  try {
    await prisma.promotion.update({
      where: { id },
      data: { isActive: false },
    });

    revalidatePath('/dashboard/crm/promotions');
    return { success: true, message: 'کمپین غیرفعال شد.' };
  } catch (error) {
    console.error('Error deactivating promotion:', error);
    return { success: false, message: 'خطا در غیرفعال‌سازی کمپین.' };
  }
}

export async function deletePromotion(id: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  try {
    await prisma.promotion.delete({
      where: { id },
    });

    revalidatePath('/dashboard/crm/promotions');
    return { success: true, message: 'کمپین حذف شد.' };
  } catch (error) {
    console.error('Error deleting promotion:', error);
    return { success: false, message: 'خطا در حذف کمپین. ممکن است در حال استفاده باشد.' };
  }
}

// Gift product to customer (moved from inventory)
export async function giftProductToCustomer(customerId: string, productId: string, quantity: number, warehouseId: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { success: false, message: 'تعداد هدیه باید عددی صحیح و بیشتر از صفر باشد.' };
  }
  try {
    const order = await prisma.$transaction(async (tx: any) => {
      const product = await tx.product.findUnique({
        where: { id: productId }
      });

      if (!product) {
        throw new Error('محصول یافت نشد.');
      }

      // No stock leaves a warehouse while it is being counted (src/lib/audit-stock-lock.ts).
      await assertNoOpenAudit(tx, [warehouseId]);

      // Deduct from inventory, only while enough is left
      const taken = await tx.inventory.updateMany({
        where: { productId, warehouseId, quantity: { gte: quantity } },
        data: {
          quantity: {
            decrement: quantity
          }
        }
      });
      if (taken.count === 0) {
        throw new Error('موجودی کافی نیست.');
      }

      // Create order with 0 amount (gift)
      const order = await tx.order.create({
        data: {
          customerId,
          totalAmount: 0,
          discount: 0,
          paidAmount: 0,
          paymentStatus: 'PAID',
          status: 'COMPLETED',
          items: {
            create: [{
              productId,
              quantity,
              price: 0, // Gift price
              warehouseId,
            }]
          }
        }
      });

      // The warehouse's movement history shows the gift, as a sale at 0.
      await tx.inventoryMovement.create({
        data: {
          productId,
          fromWarehouseId: warehouseId,
          quantity,
          type: 'SALE',
          referenceId: order.id,
          note: `هدیه - سفارش #${order.number}`,
        },
      });
      return order;
    });
    kickSiteHook();

    revalidatePath('/dashboard/crm/customers');
    revalidatePath(`/dashboard/crm/customers/${customerId}`);
    return { success: true, message: 'هدیه با موفقیت ثبت شد.', orderId: order.id };
  } catch (error) {
    console.error('Error gifting product:', error);
    const known =
      error instanceof WarehouseUnderAudit ||
      (error instanceof Error && ['محصول یافت نشد.', 'موجودی کافی نیست.'].includes(error.message));
    return { success: false, message: known ? (error as Error).message : 'خطا در ثبت هدیه.' };
  }
}
