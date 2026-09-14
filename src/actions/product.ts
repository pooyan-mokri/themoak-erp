'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { generateProductBarcode, ensureUniqueBarcode } from '@/lib/barcode-utils';
import { ActionState, ActionResult } from '@/lib/types';
import { parseWebId, webIdConflictMessage, isWebIdUniqueViolation } from '@/lib/web-id';
import { SITE_UNKNOWN_SKU } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';

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

  const webIdInput = parseWebId(formData.get('webId'));
  if (!webIdInput.ok) {
    return { errors: { webId: [webIdInput.message] }, message: webIdInput.message };
  }
  const webId = webIdInput.value;
  if (webId) {
    const conflict = await webIdConflictMessage(prisma, webId);
    if (conflict) return { errors: { webId: [conflict] }, message: conflict };
  }

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
        webId,
      },
    });
  } catch (error) {
    if (webId && isWebIdUniqueViolation(error)) {
      const conflict = (await webIdConflictMessage(prisma, webId)) ?? 'این شناسهٔ سایت تکراری است.';
      return { errors: { webId: [conflict] }, message: conflict };
    }
    console.error('Error creating product:', error);
    return {
      message: 'خطا در ثبت کالا. ممکن است SKU تکراری باشد.',
    };
  }

  kickSiteHook();
  revalidatePath('/dashboard/inventory/products');
  return { message: 'کالا با موفقیت ثبت شد.', success: true };
}

export async function getProducts() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
    // Convert Decimal to number for client components
    return products.map((product: any) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? undefined,
      productType: product.productType,
      costPrice: Number(product.costPrice),
      sellPrice: Number(product.sellPrice),
      image: product.image ?? undefined,
      wooId: product.wooId ?? undefined,
      webId: product.webId ?? undefined,
      imageUrl: product.imageUrl ?? undefined,
      siteUrl: product.siteUrl ?? undefined,
    }));
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

export async function giftProduct(productId: string, quantity: number, recipient: string, note?: string) {
  try {
    const result = await prisma.$transaction(async (tx: any) => {
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
    kickSiteHook();

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

  // An absent webId field means "leave it"; an empty one means "clear it".
  const rawWebId = formData.get('webId');
  let webIdChange: { webId: string | null } | undefined;

  try {
    // Get old product data to check if price changed
    const oldProduct = await prisma.product.findUnique({
      where: { id },
      select: { sellPrice: true, wooId: true, webId: true, sku: true }
    });

    // Only a real change is validated, so a stored value never blocks an
    // unrelated edit such as a price change.
    const typedWebId = typeof rawWebId === 'string' ? rawWebId.trim() || null : null;
    if (rawWebId !== null && oldProduct && typedWebId !== oldProduct.webId) {
      const webIdInput = parseWebId(rawWebId);
      if (!webIdInput.ok) {
        return { errors: { webId: [webIdInput.message] }, message: webIdInput.message };
      }
      // The placeholder collects website lines with an unknown webId; with a
      // webId of its own, real website sales would land on it.
      if (webIdInput.value && (oldProduct.sku === SITE_UNKNOWN_SKU || sku === SITE_UNKNOWN_SKU)) {
        const message = 'کالای ناشناختهٔ سایت شناسهٔ سایت نمی‌گیرد.';
        return { errors: { webId: [message] }, message };
      }
      // Once set, the webId is how the website finds this product: changing or
      // clearing it silently repoints the site. The form locks the field and
      // only sends this confirmation after its warning dialog, so a mismatch
      // without it is a stale page or a crafted request.
      if (oldProduct.webId && formData.get('confirmWebIdChange') !== '1') {
        const message = 'شناسهٔ سایت این کالا ثبت شده و بدون تأیید قابل تغییر نیست. صفحه را تازه کنید؛ برای تغییر عمدی، «تغییر شناسه» را بزنید و هشدار را تأیید کنید.';
        return { errors: { webId: [message] }, message };
      }
      if (webIdInput.value) {
        const conflict = await webIdConflictMessage(prisma, webIdInput.value, id);
        if (conflict) return { errors: { webId: [conflict] }, message: conflict };
      }
      webIdChange = { webId: webIdInput.value };
    }

    const data = {
      name,
      sku,
      productType,
      costPrice,
      sellPrice,
      image: validatedImage || undefined,
      wooId,
      // A new or cleared webId invalidates the photo and link that came with the
      // old one; the next catalogue sync refills them for the new webId.
      ...(webIdChange ? { ...webIdChange, imageUrl: null, siteUrl: null } : {}),
    };
    if (webIdChange) {
      // Write only if the webId is still the value checked above, so one set
      // concurrently (e.g. by the seed) is never replaced. updateMany, because
      // update's unique `where` cannot filter on a null webId.
      const { count } = await prisma.product.updateMany({ where: { id, webId: oldProduct!.webId }, data });
      if (count === 0) {
        const message = 'شناسهٔ سایت این کالا هم‌زمان تغییر کرد؛ صفحه را تازه کنید.';
        return { errors: { webId: [message] }, message };
      }
    } else {
      await prisma.product.update({ where: { id }, data });
    }
    kickSiteHook();

    // If sell price changed and product has WooCommerce ID, update WooCommerce
    if (oldProduct && oldProduct.wooId && Number(oldProduct.sellPrice) !== sellPrice) {
      const { updateProductPriceInWooCommerce } = await import('./woocommerce');
      const wooResult = await updateProductPriceInWooCommerce(id, sellPrice);

      if (wooResult.success && wooResult.data?.updated) {
        console.log(`[Product Update] قیمت در WooCommerce هم به‌روزرسانی شد`);
      }
    }
  } catch (error) {
    if (webIdChange?.webId && isWebIdUniqueViolation(error)) {
      const conflict = (await webIdConflictMessage(prisma, webIdChange.webId, id)) ?? 'این شناسهٔ سایت تکراری است.';
      return { errors: { webId: [conflict] }, message: conflict };
    }
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
    kickSiteHook();

    revalidatePath('/dashboard/inventory/products');
    return { success: true, message: 'محصول با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting product:', error);
    return { success: false, message: 'خطا در حذف محصول.' };
  }
}
