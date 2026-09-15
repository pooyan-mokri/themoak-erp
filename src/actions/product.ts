'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { generateUniqueBarcode } from '@/lib/barcode-utils';
import { barcodeFormatFor, isStandardBarcode, type BarcodeFormat } from '@/lib/barcode-format';
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
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, sku, productType, costPrice, sellPrice, image: validatedImage } = validatedFields.data;

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
    const barcode = await generateUniqueBarcode();

    await prisma.product.create({
      data: {
        name,
        sku,
        barcode,
        productType,
        costPrice,
        sellPrice,
        image: validatedImage || undefined,
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
        const barcode = await generateUniqueBarcode();
        
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
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, sku, productType, costPrice, sellPrice, image: validatedImage } = validatedFields.data;

  // An absent webId field means "leave it"; an empty one means "clear it".
  const rawWebId = formData.get('webId');
  let webIdChange: { webId: string | null } | undefined;

  try {
    // Get old product data
    const oldProduct = await prisma.product.findUnique({
      where: { id },
      select: { webId: true, sku: true }
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

// Generate or update barcode for existing products. With replace, an existing barcode is swapped for a new one.
export async function generateProductBarcodeAction(
  productId: string,
  replace = false,
): Promise<{ success: boolean; message: string; barcode?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: 'دسترسی غیرمجاز' };
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return { success: false, message: 'محصول یافت نشد.' };
    }

    if (product.barcode && !replace) {
      return { success: false, message: 'این محصول قبلاً بارکد دارد.' };
    }

    const barcode = await generateUniqueBarcode();

    // Write only over the barcode read above, so a code issued meanwhile (a second click, another tab) and the
    // labels already printed with it stay valid.
    const { count } = await prisma.product.updateMany({
      where: { id: productId, barcode: product.barcode },
      data: { barcode },
    });
    if (count === 0) {
      return { success: false, message: 'بارکد این کالا هم‌زمان تغییر کرد؛ صفحه را تازه کنید.' };
    }

    revalidatePath(`/dashboard/inventory/products/${productId}`);
    revalidatePath('/dashboard/inventory/products');
    return {
      success: true,
      message: product.barcode
        ? 'بارکد جدید ساخته شد؛ برچسب‌های قبلی این کالا دیگر خوانده نمی‌شوند.'
        : 'بارکد با موفقیت تولید شد.',
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

async function requireSignedIn() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
}

/** Products whose barcode is missing or not standard (isStandardBarcode), without the SITE-UNKNOWN placeholder. */
async function productsWithNonStandardBarcode() {
  const products: Array<{ id: string; barcode: string | null }> = await prisma.product.findMany({
    where: { sku: { not: SITE_UNKNOWN_SKU } },
    select: { id: true, barcode: true },
  });
  return products.filter((product) => !isStandardBarcode(product.barcode));
}

export async function countNonStandardBarcodes(): Promise<number> {
  await requireSignedIn();
  return (await productsWithNonStandardBarcode()).length;
}

const BARCODE_REPLACE_BATCH = 100;

/**
 * Give every product counted by countNonStandardBarcodes a new in-store EAN-13 (admin only); its old labels stop
 * scanning. Each batch is one transaction. A product whose barcode changed after it was read is skipped, and stays
 * counted if its code is still non-standard.
 */
export async function replaceNonStandardBarcodes(): Promise<{
  success: boolean;
  message: string;
  replaced?: number;
  /** The products given a new code, so their labels can be printed next. */
  replacedIds?: string[];
}> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند بارکدها را یک‌جا عوض کند.' };
  }

  const replacedIds: string[] = [];
  try {
    const products = await productsWithNonStandardBarcode();
    for (let i = 0; i < products.length; i += BARCODE_REPLACE_BATCH) {
      const batch = products.slice(i, i + BARCODE_REPLACE_BATCH);
      // generateUniqueBarcode sees saved codes only, so keep this batch's unsaved codes distinct too.
      const codes = new Set<string>();
      while (codes.size < batch.length) codes.add(await generateUniqueBarcode());
      const batchCodes = [...codes];
      const batchIds: string[] = await prisma.$transaction(async (tx: any) => {
        const ids: string[] = [];
        for (let j = 0; j < batch.length; j++) {
          const { id, barcode } = batch[j];
          if ((await tx.product.updateMany({ where: { id, barcode }, data: { barcode: batchCodes[j] } })).count === 1) {
            ids.push(id);
          }
        }
        return ids;
      }, { maxWait: 10_000, timeout: 60_000 });
      replacedIds.push(...batchIds);
    }
    const replaced = replacedIds.length;
    return {
      success: true,
      message: `بارکد استاندارد برای ${replaced.toLocaleString('fa-IR')} کالا ساخته شد.`,
      replaced,
      replacedIds,
    };
  } catch (error: unknown) {
    console.error('Error replacing barcodes:', error);
    return {
      success: false,
      message: `خطا در ساخت بارکدها؛ تا این لحظه بارکد ${replacedIds.length.toLocaleString('fa-IR')} کالا عوض شد. لطفاً دوباره تلاش کنید.`,
      replaced: replacedIds.length,
      replacedIds,
    };
  } finally {
    revalidatePath('/dashboard/inventory/products');
  }
}

const LABEL_ROWS_CAP = 2000;

export type ProductForLabel = {
  id: string;
  name: string;
  sku: string;
  webId: string | null;
  barcode: string | null;
  format: BarcodeFormat | null;
  quantity: number | null;
};

/**
 * Products for printing labels, ordered by name, at most 2000. quantity is the stock in warehouseId (null without
 * one), and inStockOnly applies only with a warehouseId. The SITE-UNKNOWN placeholder is left out.
 */
export async function getProductsForLabels(input: {
  search?: string;
  warehouseId?: string;
  inStockOnly?: boolean;
  nonStandardOnly?: boolean;
}): Promise<ProductForLabel[]> {
  await requireSignedIn();
  const search = input.search?.trim();
  const warehouseId = input.warehouseId || undefined;

  const where: Record<string, unknown> = { sku: { not: SITE_UNKNOWN_SKU } };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { webId: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (warehouseId && input.inStockOnly) {
    where.inventory = { some: { warehouseId, quantity: { gt: 0 } } };
  }

  const products: Array<
    Omit<ProductForLabel, 'format' | 'quantity'> & { inventory?: Array<{ quantity: number }> }
  > = await prisma.product.findMany({
    where,
    orderBy: [{ name: 'asc' }, { sku: 'asc' }],
    // The barcode check cannot run in the query, so with nonStandardOnly the cap applies after filtering.
    take: input.nonStandardOnly ? undefined : LABEL_ROWS_CAP,
    select: {
      id: true,
      name: true,
      sku: true,
      webId: true,
      barcode: true,
      inventory: warehouseId ? { where: { warehouseId }, select: { quantity: true } } : false,
    },
  });

  return products
    .filter((product) => !input.nonStandardOnly || !isStandardBarcode(product.barcode))
    .slice(0, LABEL_ROWS_CAP)
    .map(({ inventory, ...product }) => ({
      ...product,
      format: product.barcode ? barcodeFormatFor(product.barcode) : null,
      quantity: warehouseId ? (inventory?.[0]?.quantity ?? 0) : null,
    }));
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
