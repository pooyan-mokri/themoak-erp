'use server';
// Force IDE refresh


import { PrismaClient, DepreciationMethod, FixedAsset } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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
        currentValue: purchasePrice, // Initially equal to purchase price
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
  try {
    const assets = await prisma.fixedAsset.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Calculate current value on the fly for display accuracy
    // Convert Decimal to number for client components
    return assets.map((asset: any) => {
      const currentValue = calculateCurrentValue(asset);
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

    let expenseAccount = await prisma.account.findFirst({
      where: { name: 'هزینه‌های عمومی' }
    });

    if (!expenseAccount) {
      expenseAccount = await prisma.account.create({
        data: {
          name: 'هزینه‌های عمومی',
          type: 'EXPENSE',
          balance: 0,
          currency: 'TOMAN'
        }
      });
    }

    await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: annualDepreciation,
        amountInToman: annualDepreciation,
        currency: 'TOMAN',
        category: 'Depreciation',
        description: `استهلاک سالانه دارایی: ${asset.name}`,
        accountId: expenseAccount.id,
        date: new Date(),
      }
    });

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
