'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { generateProductBarcode, ensureUniqueBarcode } from '@/lib/barcode-utils';
import { ActionState, ActionResult } from '@/lib/types';

const ProductSchema = z.object({
  name: z.string().min(1, 'نام کالا الزامی است'),
  sku: z.string().min(1, 'کد کالا (SKU) الزامی است'),
  productType: z.enum(['SALEABLE', 'FIXED_ASSET', 'CONSUMABLE', 'OTHER']),
  costPrice: z.coerce.number().min(0, 'قیمت خرید نمی‌تواند منفی باشد'),
  sellPrice: z.coerce.number().min(0, 'قیمت فروش نمی‌تواند منفی باشد'),
  image: z.string().optional(),
  wooId: z.coerce.number().optional(),
});

export async function createProduct(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const imageValue = formData.get('image');
  const image = imageValue && imageValue.toString().trim() ? imageValue.toString().trim() : undefined;

  const validatedFields = ProductSchema.safeParse({
    name: formData.get('name'),
    sku: formData.get('sku'),
    productType: formData.get('productType'),
    costPrice: formData.get('costPrice'),
    sellPrice: formData.get('sellPrice'),
    image: image || undefined,
    wooId: formData.get('wooId') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, sku, productType, costPrice, sellPrice, image: validatedImage, wooId } = validatedFields.data;

  try {
    // Generate unique barcode if not provided
    const baseBarcode = generateProductBarcode(sku);
    const barcode = await ensureUniqueBarcode(baseBarcode);

    await prisma.product.create({
      data: {
        name,
        sku,
        barcode,
        productType,
        costPrice,
        sellPrice,
        image: validatedImage || undefined,
        wooId,
      },
    });
  } catch (error) {
    console.error('Error creating product:', error);
    return {
      message: 'خطا در ثبت کالا. ممکن است SKU تکراری باشد.',
    };
  }

  revalidatePath('/dashboard/inventory/products');
  return { message: 'کالا با موفقیت ثبت شد.', success: true };
}

export async function getProducts() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
    // Convert Decimal to number for client components
    return products.map(product => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? undefined,
      productType: product.productType,
      costPrice: Number(product.costPrice),
      sellPrice: Number(product.sellPrice),
      image: product.image ?? undefined,
      wooId: product.wooId ?? undefined,
    }));
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

export async function giftProduct(productId: string, quantity: number, recipient: string, note?: string) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find product to get cost price
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error('Product not found');

      // 2. Find stock (simplification: take from first warehouse with enough stock)
      const inventory = await tx.inventory.findFirst({
        where: { productId, quantity: { gte: quantity } },
      });

      if (!inventory) throw new Error('Insufficient stock');

      // 3. Decrement stock
      await tx.inventory.update({
        where: {
            productId_warehouseId: {
                productId,
                warehouseId: inventory.warehouseId
            }
        },
        data: { quantity: { decrement: quantity } }
      });

      // 4. Find/Create Expense Account
      let expenseAccount = await tx.account.findFirst({ where: { name: 'Marketing Expenses' } });
      if (!expenseAccount) {
        expenseAccount = await tx.account.create({
          data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN' }
        });
      }

      // 5. Create Expense Transaction
      const totalCost = Number(product.costPrice) * quantity;
      await tx.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: totalCost,
          amountInToman: totalCost,
          currency: 'TOMAN',
          category: 'Marketing/Gift',
          description: `Gift to ${recipient}: ${note || ''}`,
          accountId: expenseAccount.id,
          date: new Date(),
        }
      });

      // 6. Update Account Balance
      await tx.account.update({
        where: { id: expenseAccount.id },
        data: { balance: { decrement: totalCost } }
      });

      return { success: true, message: 'Gift processed successfully' };
    });

    try {
      revalidatePath('/dashboard/inventory/products');
      revalidatePath('/dashboard/accounting/transactions');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return result;
  } catch (error: unknown) {
    console.error('Error gifting product:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to gift product' };
  }
}

export async function importProducts(products: Array<Record<string, unknown>>) {
  let successCount = 0;
  let errorCount = 0;

  for (const p of products) {
    try {
      // Basic validation
      if (!p.name || !p.sku) {
        errorCount++;
        continue;
      }

      const existing = await prisma.product.findUnique({
        where: { sku: String(p.sku) },
      });

      if (existing) {
        // Update existing product
        await prisma.product.update({
          where: { sku: String(p.sku) },
          data: {
            name: String(p.name),
            costPrice: Number(p.costPrice) || 0,
            sellPrice: Number(p.sellPrice) || 0,
            image: typeof p.image === 'string' ? p.image : undefined,
            // Don't update barcode if it exists
          },
        });
      } else {
        // Create new product with barcode
        const baseBarcode = generateProductBarcode(String(p.sku));
        const barcode = await ensureUniqueBarcode(baseBarcode);
        
        await prisma.product.create({
          data: {
            name: String(p.name),
            sku: String(p.sku),
            barcode,
            costPrice: Number(p.costPrice) || 0,
            sellPrice: Number(p.sellPrice) || 0,
            image: typeof p.image === 'string' ? p.image : undefined,
          },
        });
      }
      successCount++;
    } catch (error) {
      console.error(`Error importing product ${p.sku}:`, error);
      errorCount++;
    }
  }

  revalidatePath('/dashboard/inventory/products');
  return { success: true, successCount, errorCount };
}

export async function updateProduct(id: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const imageValue = formData.get('image');
  const image = imageValue && imageValue.toString().trim() ? imageValue.toString().trim() : undefined;

  const validatedFields = ProductSchema.safeParse({
    name: formData.get('name'),
    sku: formData.get('sku'),
    productType: formData.get('productType'),
    costPrice: formData.get('costPrice'),
    sellPrice: formData.get('sellPrice'),
    image: image || undefined,
    wooId: formData.get('wooId') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, sku, productType, costPrice, sellPrice, image: validatedImage, wooId } = validatedFields.data;

  try {
    await prisma.product.update({
      where: { id },
      data: {
        name,
        sku,
        productType,
        costPrice,
        sellPrice,
        image: validatedImage || undefined,
        wooId,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ویرایش کالا. ممکن است SKU تکراری باشد.',
    };
  }

  revalidatePath('/dashboard/inventory/products');
  return { message: 'کالا با موفقیت ویرایش شد.', success: true };
}

// Generate or update barcode for existing products
export async function generateProductBarcodeAction(productId: string) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return { success: false, message: 'محصول یافت نشد.' };
    }

    if (product.barcode) {
      return { success: false, message: 'این محصول قبلاً بارکد دارد.' };
    }

    const baseBarcode = generateProductBarcode(product.sku);
    const barcode = await ensureUniqueBarcode(baseBarcode);

    await prisma.product.update({
      where: { id: productId },
      data: { barcode },
    });

    revalidatePath(`/dashboard/inventory/products/${productId}`);
    revalidatePath('/dashboard/inventory/products');
    return {
      success: true,
      message: 'بارکد با موفقیت تولید شد.',
      barcode,
    };
  } catch (error: unknown) {
    console.error('Error generating barcode:', error);
    return {
      success: false,
      message: 'خطا در تولید بارکد. لطفاً دوباره تلاش کنید.',
    };
  }
}

export async function deleteProduct(id: string) {
  try {
    // Check for inventory
    const inventoryCount = await prisma.inventory.count({
      where: { productId: id },
    });

    if (inventoryCount > 0) {
      return { success: false, message: 'این محصول دارای موجودی است و قابل حذف نیست.' };
    }

    // Check for order items
    const orderItemCount = await prisma.orderItem.count({
      where: { productId: id },
    });

    if (orderItemCount > 0) {
      return { success: false, message: 'این محصول در سفارشات استفاده شده و قابل حذف نیست.' };
    }

    await prisma.product.delete({
      where: { id },
    });

    revalidatePath('/dashboard/inventory/products');
    return { success: true, message: 'محصول با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting product:', error);
    return { success: false, message: 'خطا در حذف محصول.' };
  }
}
