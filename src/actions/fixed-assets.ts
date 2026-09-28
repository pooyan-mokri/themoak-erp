'use server';
// Force IDE refresh


import { PrismaClient, DepreciationMethod, FixedAsset } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkPermission, requirePermission } from '@/lib/access';
import { isDuplicateRequest } from '@/lib/request-id';
import { jalaliYearMonth } from '@/lib/tehran-day';
import { consumableValue } from '@/lib/fixed-asset-value';

/**
 * One depreciation row per asset per Jalali year. The row carries this key in
 * its unique clientRequestId, so a second post of the same year, even one
 * clicked at the same moment, cannot be written.
 */
const depreciationKey = (assetId: string, year: number) => `depreciation-${assetId}-${year}`;

// Use z.enum instead of z.nativeEnum to avoid runtime issues
const FixedAssetSchema = z.object({
  name: z.string().min(1, 'نام دارایی الزامی است'),
  assetType: z.enum(['FIXED', 'CONSUMABLE']),
  purchaseDate: z.string().min(1, 'تاریخ خرید الزامی است'),
  purchasePrice: z.coerce.number().min(0, 'قیمت خرید باید معتبر باشد'),
  salvageValue: z.coerce.number().min(0, 'ارزش اسقاط باید معتبر باشد'),
  usefulLife: z.coerce.number().min(1, 'عمر مفید باید حداقل ۱ سال باشد'),
  quantity: z.coerce.number().min(0, 'تعداد باید معتبر باشد').optional(),
}).refine((data) => {
  // If assetType is CONSUMABLE, quantity is required
  if (data.assetType === 'CONSUMABLE') {
    return data.quantity !== undefined && data.quantity !== null && data.quantity > 0;
  }
  return true;
}, {
  message: 'برای کالای مصرفی، تعداد الزامی است',
  path: ['quantity'],
});

export async function createAsset(prevState: any, formData: FormData) {
  const denied = await checkPermission('finance.manage');
  if (denied) return { message: denied.message };
  const validatedFields = FixedAssetSchema.safeParse({
    name: formData.get('name'),
    assetType: formData.get('assetType'),
    purchaseDate: formData.get('purchaseDate'),
    purchasePrice: formData.get('purchasePrice'),
    salvageValue: formData.get('salvageValue'),
    usefulLife: formData.get('usefulLife'),
    quantity: formData.get('quantity'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, assetType, purchaseDate, purchasePrice, salvageValue, usefulLife, quantity } = validatedFields.data;

  try {
    await prisma.fixedAsset.create({
      data: {
        name,
        assetType: assetType as any,
        purchaseDate: new Date(purchaseDate),
        purchasePrice,
        salvageValue,
        usefulLife,
        quantity: assetType === 'CONSUMABLE' ? quantity : undefined,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        // Initially the purchase price; a consumable is worth quantity × unit price (src/lib/fixed-asset-value.ts).
        currentValue: assetType === 'CONSUMABLE' ? consumableValue({ quantity, purchasePrice }) : purchasePrice,
      },
    });
  } catch (error) {
    console.error('Error creating asset:', error);
    return {
      message: 'خطا در ثبت دارایی.',
    };
  }

  revalidatePath('/dashboard/accounting/assets');
  revalidatePath('/dashboard/inventory/assets');
  return { message: 'دارایی با موفقیت ثبت شد.', success: true };
}

export async function getAssets() {
  await requirePermission('finance.view');
  try {
    const assets = await prisma.fixedAsset.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Calculate current value on the fly for display accuracy
    // Convert Decimal to number for client components
    return assets.map((asset: any) => {
      // A consumable is worth quantity × unit cost, not depreciated as one item.
      const currentValue = asset.assetType === 'CONSUMABLE' ? consumableValue(asset) : calculateCurrentValue(asset);
      return {
        ...asset,
        purchasePrice: Number(asset.purchasePrice),
        salvageValue: Number(asset.salvageValue),
        currentValue,
        quantity: asset.quantity ?? undefined,
      };
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
    return [];
  }
}

function calculateCurrentValue(asset: FixedAsset) {
  const now = new Date();
  const purchaseDate = new Date(asset.purchaseDate);
  const ageInMilliseconds = now.getTime() - purchaseDate.getTime();
  const ageInYears = ageInMilliseconds / (1000 * 60 * 60 * 24 * 365.25);

  if (ageInYears <= 0) return Number(asset.purchasePrice);
  if (ageInYears >= asset.usefulLife) return Number(asset.salvageValue);

  // Straight Line Depreciation
  // Annual Depreciation = (Cost - Salvage) / Useful Life
  const cost = Number(asset.purchasePrice);
  const salvage = Number(asset.salvageValue);
  const usefulLife = asset.usefulLife;

  const annualDepreciation = (cost - salvage) / usefulLife;
  const totalDepreciation = annualDepreciation * ageInYears;

  return Math.max(Number(asset.salvageValue), cost - totalDepreciation);
}

export async function postDepreciation(assetId: string) {
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;
  try {
    const asset = await prisma.fixedAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return { success: false, error: 'دارایی یافت نشد' };
    }

    const currentValue = calculateCurrentValue(asset);
    const purchasePrice = Number(asset.purchasePrice);
    const salvageValue = Number(asset.salvageValue);
    
    const annualDepreciation = (purchasePrice - salvageValue) / asset.usefulLife;
    
    if (currentValue <= salvageValue) {
      return { success: false, error: 'این دارایی کاملاً مستهلک شده است' };
    }

    // This Jalali year's depreciation is booked once. Rows posted before the
    // key existed are found by their description and date.
    const year = jalaliYearMonth(new Date()).year;
    const description = `استهلاک سالانه دارایی: ${asset.name}`;
    const posted = await prisma.transaction.findMany({
      where: {
        category: 'Depreciation',
        OR: [{ clientRequestId: { startsWith: `depreciation-${asset.id}-` } }, { clientRequestId: null, description }],
      },
      select: { amount: true, date: true, clientRequestId: true },
    });
    const alreadyThisYear = (message: string) => ({ success: false, error: message, message });
    const yearLabel = year.toLocaleString('fa-IR', { useGrouping: false });
    if (posted.some((row: any) => row.clientRequestId === depreciationKey(asset.id, year) || (!row.clientRequestId && jalaliYearMonth(row.date).year === year))) {
      return alreadyThisYear(`استهلاک سال ${yearLabel} برای «${asset.name}» قبلاً ثبت شده است.`);
    }
    // Never more than the cost less the salvage value, over all the years.
    const depreciatedSoFar = posted.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
    const amount = Math.min(annualDepreciation, purchasePrice - salvageValue - depreciatedSoFar);
    if (!(amount > 0)) {
      return { success: false, error: 'این دارایی کاملاً مستهلک شده است' };
    }

    let expenseAccount = await prisma.account.findFirst({
      where: { name: 'هزینه‌های عمومی' }
    });

    if (!expenseAccount) {
      // Under one fixed id: two posts at the same moment both find it missing,
      // and a plain create made one copy each (the name is not unique).
      await prisma.account.createMany({
        data: [{ id: 'general-expenses', name: 'هزینه‌های عمومی', type: 'EXPENSE', balance: 0, currency: 'TOMAN' }],
        skipDuplicates: true,
      });
      expenseAccount = await prisma.account.findUniqueOrThrow({ where: { id: 'general-expenses' } });
    }

    // Depreciation is non-cash: the row feeds P&L, but the expense account's
    // balance deliberately stays 0 (same as consignment COGS) so it never
    // leaks into the cash totals.
    try {
      await prisma.transaction.create({
        data: {
          type: 'EXPENSE',
          amount,
          amountInToman: amount,
          currency: 'TOMAN',
          category: 'Depreciation',
          description,
          accountId: expenseAccount.id,
          date: new Date(),
          clientRequestId: depreciationKey(asset.id, year),
        }
      });
    } catch (error) {
      // A second post of the same year at the same moment: the first one wrote it.
      if (isDuplicateRequest(error)) return alreadyThisYear(`استهلاک سال ${yearLabel} برای «${asset.name}» قبلاً ثبت شده است.`);
      throw error;
    }

    try {
      revalidatePath('/dashboard/accounting/assets');
      revalidatePath('/dashboard/inventory/assets');
      revalidatePath('/dashboard/accounting/transactions');
    } catch (e) {
      // Ignore revalidation error in non-request context
    }
    return { success: true, message: 'سند استهلاک با موفقیت ثبت شد' };
  } catch (error) {
    console.error('Error posting depreciation:', error);
    return { success: false, error: 'خطا در ثبت استهلاک' };
  }
}

export async function deleteAsset(assetId: string) {
  const denied = await checkPermission('finance.manage');
  if (denied) return denied;
  try {
    await prisma.fixedAsset.delete({
      where: { id: assetId },
    });
    
    revalidatePath('/dashboard/accounting/assets');
    revalidatePath('/dashboard/inventory/assets');
    return { success: true, message: 'دارایی با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting asset:', error);
    return { success: false, message: 'خطا در حذف دارایی.' };
  }
}
