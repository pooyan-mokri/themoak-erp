'use server';

import { prisma } from '@/lib/prisma';
import { TransactionType, ActionState, ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, hasPermission, requirePermission } from '@/lib/access';
import { inAccountCurrency } from '@/lib/balance-reconciliation';

// --- Schemas ---

const MarketingGiftItemSchema = z.object({
  productId: z.string().min(1, 'محصول الزامی است'),
  quantity: z.coerce.number().min(1, 'تعداد باید بیشتر از صفر باشد'),
  warehouseId: z.string().min(1, 'انبار الزامی است'),
});

const MarketingGiftSchema = z.object({
  items: z.string().min(1, 'حداقل یک محصول الزامی است').transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'حداقل یک محصول الزامی است',
        });
        return z.NEVER;
      }
      return parsed.map((item: any) => MarketingGiftItemSchema.parse(item));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'فرمت لیست محصولات نامعتبر است',
      });
      return z.NEVER;
    }
  }),
  recipientName: z.string().min(1, 'نام گیرنده الزامی است'),
  accountId: z.string().min(1, 'حساب برای ثبت هزینه الزامی است'),
  reason: z.string().optional(),
  notes: z.string().optional(),
  date: z.string().optional(),
  campaignId: z.string().optional(),
});

const MarketingCampaignSchema = z.object({
  name: z.string().min(1, 'نام کمپین الزامی است'),
  description: z.string().optional(),
  type: z.string().min(1, 'نوع کمپین الزامی است'),
  startDate: z.string().min(1, 'تاریخ شروع الزامی است'),
  endDate: z.string().optional(),
  budget: z.coerce.number().optional(),
  status: z.string().optional(),
});

// --- Actions ---

export async function createMarketingGift(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const campaignIdValue = formData.get('campaignId');
  
  const validatedFields = MarketingGiftSchema.safeParse({
    items: formData.get('items'),
    recipientName: formData.get('recipientName'),
    accountId: formData.get('accountId'),
    reason: formData.get('reason') || undefined,
    notes: formData.get('notes') || undefined,
    date: formData.get('date'),
    campaignId: campaignIdValue && campaignIdValue.toString().trim() ? campaignIdValue.toString().trim() : undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const {
    items,
    recipientName,
    accountId,
    reason,
    notes,
    date,
    campaignId,
  } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Validate all products and calculate total cost
      let totalCost = 0;
      const validatedItems = [];
      
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new Error(`محصول با شناسه ${item.productId} یافت نشد.`);
        }

        const costPrice = Number(product.costPrice || 0);
        const itemCost = costPrice * item.quantity;
        totalCost += itemCost;

        // Check inventory availability in selected warehouse
        const inventory = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: item.warehouseId,
            },
          },
        });

        if (!inventory || inventory.quantity < item.quantity) {
          const warehouse = await tx.warehouse.findUnique({
            where: { id: item.warehouseId },
            select: { name: true },
          });
          const warehouseName = warehouse?.name || 'انبار انتخاب شده';
          throw new Error(
            `موجودی کافی برای محصول "${product.name}" در ${warehouseName} وجود ندارد. موجودی: ${inventory?.quantity || 0}، مورد نیاز: ${item.quantity}`
          );
        }

        validatedItems.push({
          product,
          costPrice,
          itemCost,
          quantity: item.quantity,
          warehouseId: item.warehouseId,
        });
      }

      // 2. Get account and check balance
      const account = await tx.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new Error('حساب یافت نشد.');
      }

      // A gift is stock given away at cost, not money leaving a bank: it goes on
      // an EXPENSE account (which tracks spend and needs no balance), never on a
      // bank or cash account whose balance has to match the bank.
      if (account.type !== 'EXPENSE') {
        throw new Error(`هدیه فقط روی حساب هزینه ثبت می‌شود؛ «${account.name}» حساب هزینه نیست.`);
      }

      // 3. Create transaction for marketing expense
      const transactionDate = date ? new Date(date) : new Date();
      const productNames = validatedItems.map((item: any) => `${item.product.name} (${item.quantity} عدد)`).join('، ');
      // The cost is in Toman; the account is kept in its own currency.
      const booked = await inAccountCurrency(tx, account, totalCost);
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.EXPENSE,
          amount: new Prisma.Decimal(booked.amount),
          currency: account.currency,
          rateSnapshot: new Prisma.Decimal(booked.rate),
          amountInToman: new Prisma.Decimal(totalCost),
          accountId,
          description: `هزینه بازاریابی - هدیه: ${productNames}${recipientName ? ` - گیرنده: ${recipientName}` : ''}${reason ? ` - دلیل: ${reason}` : ''}`,
          date: transactionDate,
          category: 'Marketing - Gift',
        },
      });

      // 4. Update account balance (decrement)
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            decrement: new Prisma.Decimal(booked.amount),
          },
        },
      });

      // 5. Create marketing gift records for each item and deduct inventory
      // Note: transactionId is unique, so only the first gift will have it
      for (let i = 0; i < validatedItems.length; i++) {
        const item = validatedItems[i];
        // Create marketing gift record
        await tx.marketingGift.create({
          data: {
            productId: item.product.id,
            quantity: item.quantity,
            recipientName: recipientName,
            accountId,
            transactionId: i === 0 ? transaction.id : undefined, // Only first item gets transactionId
            campaignId: campaignId || undefined,
            costPrice: new Prisma.Decimal(item.costPrice),
            totalCost: new Prisma.Decimal(item.itemCost),
            reason: reason || undefined,
            notes: notes || undefined,
            date: transactionDate,
          },
        });

        // Deduct inventory from selected warehouse
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: item.product.id,
              warehouseId: item.warehouseId,
            },
          },
          data: {
            quantity: { decrement: item.quantity },
          },
        });
      }

      // 6. Update campaign spent amount if campaignId provided
      if (campaignId) {
        await tx.marketingCampaign.update({
          where: { id: campaignId },
          data: {
            spentAmount: {
              increment: new Prisma.Decimal(totalCost),
            },
          },
        });
      }
    });
  } catch (error: unknown) {
    console.error('Error creating marketing gift:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در ثبت هدیه بازاریابی.',
      errors: {},
    };
  }

  kickSiteHook();
  revalidatePath('/dashboard/marketing');
  revalidatePath('/dashboard/marketing/gifts');
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/accounting/transactions');
  return { message: 'هدیه بازاریابی با موفقیت ثبت شد.', success: true };
}

// Gift cost (at cost price) and a campaign's spend, which adds gift costs up, need cost.view.
export async function getMarketingGifts() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const gifts = await prisma.marketingGift.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true, image: true, wooId: true, barcode: true } },
        account: { select: { id: true, name: true } },
        campaign: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    return gifts.map((gift: any) => {
      const { costPrice, totalCost, ...rest } = gift;
      const { spentAmount, ...campaign } = gift.campaign ?? {};
      return {
        ...rest,
        ...(canSeeCost && { costPrice: Number(costPrice), totalCost: Number(totalCost || 0) }),
        reason: gift.reason ?? undefined,
        notes: gift.notes ?? undefined,
        campaignId: gift.campaignId ?? undefined,
        recipientName: gift.recipientName ?? undefined,
        product: gift.product ? {
          ...gift.product,
          image: gift.product.image ?? undefined,
          wooId: gift.product.wooId ?? undefined,
          barcode: gift.product.barcode ?? undefined,
        } : undefined,
        campaign: gift.campaign ? {
          ...(canSeeCost ? gift.campaign : campaign),
          description: gift.campaign.description ?? undefined,
          endDate: gift.campaign.endDate ?? undefined,
          budget: gift.campaign.budget ? Number(gift.campaign.budget) : undefined,
        } : undefined,
      };
    });
  } catch (error) {
    console.error('Error fetching marketing gifts:', error);
    return [];
  }
}

export async function createMarketingCampaign(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validatedFields = MarketingCampaignSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    type: formData.get('type'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate') || undefined,
    budget: formData.get('budget') || undefined,
    status: formData.get('status') || 'PLANNED',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, description, type, startDate, endDate, budget, status } =
    validatedFields.data;

  try {
    await prisma.marketingCampaign.create({
      data: {
        name,
        description: description || undefined,
        type,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : undefined,
        budget: budget ? new Prisma.Decimal(budget) : undefined,
        status: status || 'PLANNED',
      },
    });
  } catch (error: unknown) {
    return {
      message: error instanceof Error ? error.message : 'خطا در ایجاد کمپین بازاریابی.',
      errors: {},
    };
  }

  revalidatePath('/dashboard/marketing');
  revalidatePath('/dashboard/marketing/campaigns');
  return { message: 'کمپین بازاریابی با موفقیت ایجاد شد.', success: true };
}

export async function getMarketingCampaigns() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const campaigns = await prisma.marketingCampaign.findMany({
      include: {
        _count: {
          select: { gifts: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return campaigns.map((campaign: any) => ({
      ...campaign,
      description: campaign.description ?? undefined,
      endDate: campaign.endDate ?? undefined,
      budget: campaign.budget ? Number(campaign.budget) : undefined,
      spentAmount: canSeeCost ? Number(campaign.spentAmount) : null,
    }));
  } catch (error) {
    console.error('Error fetching marketing campaigns:', error);
    return [];
  }
}

export async function getMarketingStats() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const gifts = await prisma.marketingGift.findMany({
      include: {
        product: true,
      },
    });

    const totalGifts = gifts.length;
    const totalQuantity = gifts.reduce((sum: any, gift: any) => sum + gift.quantity, 0);
    const totalCost = gifts.reduce(
  (sum: any, gift: any) => sum + Number(gift.totalCost),
      0
    );

    const giftsByProduct = gifts.reduce((acc: any, gift: any) => {
      const productName = gift.product.name;
      if (!acc[productName]) {
        acc[productName] = { quantity: 0, cost: 0 };
      }
      acc[productName].quantity += gift.quantity;
      acc[productName].cost += Number(gift.totalCost);
      return acc;
    }, {} as Record<string, { quantity: number; cost: number }>);

    const campaigns = await prisma.marketingCampaign.findMany();
    const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length;
    const totalBudget = campaigns.reduce(
  (sum: any, c: any) => sum + (c.budget ? Number(c.budget) : 0),
      0
    );
    const totalSpent = campaigns.reduce(
  (sum: any, c: any) => sum + Number(c.spentAmount),
      0
    );

    if (!canSeeCost) {
      return {
        totalGifts,
        totalQuantity,
        totalCost: null,
        giftsByProduct: Object.entries(giftsByProduct)
          .map(([name, data]: [string, any]) => ({ name, quantity: data.quantity, cost: null }))
          .sort((a: any, b: any) => b.quantity - a.quantity)
          .slice(0, 10),
        totalCampaigns: campaigns.length,
        activeCampaigns,
        totalBudget,
        totalSpent: null,
        remainingBudget: null,
      };
    }

    return {
      totalGifts,
      totalQuantity,
      totalCost,
      giftsByProduct: Object.entries(giftsByProduct)
        .map(([name, data]: [string, any]) => ({ name, ...data }))
        .sort((a: any, b: any) => b.cost - a.cost)
        .slice(0, 10),
      totalCampaigns: campaigns.length,
      activeCampaigns,
      totalBudget,
      totalSpent,
      remainingBudget: totalBudget - totalSpent,
    };
  } catch (error) {
    console.error('Error fetching marketing stats:', error);
    return {
      totalGifts: 0,
      totalQuantity: 0,
      totalCost: 0,
      giftsByProduct: [],
      totalCampaigns: 0,
      activeCampaigns: 0,
      totalBudget: 0,
      totalSpent: 0,
      remainingBudget: 0,
    };
  }
}

