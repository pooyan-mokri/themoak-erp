'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

const PromotionSchema = z.object({
  name: z.string().min(1, 'نام کمپین ال زامی است'),
  type: z.string().min(1, 'نوع تبلیغ الزامی است'), // GIFT, DISCOUNT, VOUCHER
  description: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  productId: z.string().optional(), // For GIFT type
  discountPercent: z.number().optional(), // For DISCOUNT type
  discountAmount: z.number().optional(), // For fixed discount
  minPurchase: z.number().optional(),
  maxUses: z.number().optional(),
});

export async function createPromotion(prevState: any, formData: FormData) {
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

  try {
    await prisma.promotion.create({
      data: {
        name,
        type,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
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
  try {
    const promotions = await prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Serialize Decimal fields to numbers
    return promotions.map(promotion => ({
      ...promotion,
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

    return promotions.map(promotion => ({
      ...promotion,
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
  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion) return undefined;

    return {
      ...promotion,
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
        message: `حداقل مبلغ خرید برای این کمپین ${Number(promotion.minPurchase).toLocaleString()} تومان است.` 
      };
    }

    // Calculate discount
    let discountAmount = 0;
    if (promotion.type === 'DISCOUNT') {
      if (promotion.discountPercent) {
        discountAmount = (orderTotal * Number(promotion.discountPercent)) / 100;
      } else if (promotion.discountAmount) {
        discountAmount = Number(promotion.discountAmount);
      }
    }

    return {
      success: true,
      discountAmount,
      giftProductId: promotion.type === 'GIFT' ? promotion.productId : null,
      promotionName: promotion.name,
    };
  } catch (error) {
    console.error('Error applying promotion:', error);
    return { success: false, message: 'خطا در اعمال کمپین.' };
  }
}

export async function incrementPromotionUsage(promotionId: string) {
  try {
    await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        usedCount: {
          increment: 1
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error incrementing promotion usage:', error);
    return { success: false };
  }
}

export async function deactivatePromotion(id: string) {
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
  try {
    // Check inventory
    const inventory = await prisma.inventory.findFirst({
      where: {
        productId,
        warehouseId,
      }
    });

    if (!inventory || inventory.quantity < quantity) {
      return { success: false, message: 'موجودی کافی نیست.' };
    }

    // Create order with 0 amount (gift)
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return { success: false, message: 'محصول یافت نشد.' };
    }

    const order = await prisma.order.create({
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
          }]
        }
      }
    });

    // Deduct from inventory
    await prisma.inventory.update({
      where: { 
        productId_warehouseId: {
          productId,
          warehouseId
        }
      },
      data: {
        quantity: {
          decrement: quantity
        }
      }
    });

    revalidatePath('/dashboard/crm/customers');
    revalidatePath(`/dashboard/crm/customers/${customerId}`);
    return { success: true, message: 'هدیه با موفقیت ثبت شد.', orderId: order.id };
  } catch (error) {
    console.error('Error gifting product:', error);
    return { success: false, message: 'خطا در ثبت هدیه.' };
  }
}
