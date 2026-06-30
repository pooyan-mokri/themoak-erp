'use server';
// WooCommerce Actions

import { getWooCommerceClient } from '@/lib/woocommerce';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSetting, getWooSettings } from './settings';
import { Prisma } from '@prisma/client';
import { TransactionType, ActionResult } from '@/lib/types';
import { downloadAndSaveProductImage } from './upload';

// Helper function to get WooCommerce warehouse ID from settings
async function getWooWarehouseId(): Promise<string | undefined> {
  const wooSettings = await getSetting('woo_settings');
  if (wooSettings?.warehouseId) {
    return wooSettings.warehouseId;
  }
  // Fallback to Main Warehouse if not configured
  const warehouse = await prisma.warehouse.findFirst({ where: { name: 'Main Warehouse', isArchived: false } });
  return warehouse?.id || undefined;
}

// Test WooCommerce connection
export async function testWooCommerceConnection(): Promise<ActionResult<{
  productsCount?: number;
  ordersCount?: number;
  canReadProducts: boolean;
  canReadOrders: boolean;
}>> {
  try {
    const wooCommerce = await getWooCommerceClient();

    // Test 1: Try to get products (get total count from headers)
    const productsResponse = await wooCommerce.get("products", { per_page: 1 });

    // Test 2: Try to get orders (get total count from headers)
    const ordersResponse = await wooCommerce.get("orders", { per_page: 1 });

    // Extract total count from response headers
    const totalProducts = productsResponse.headers?.['x-wp-total']
      ? parseInt(productsResponse.headers['x-wp-total'] as string)
      : productsResponse.data?.length || 0;

    const totalOrders = ordersResponse.headers?.['x-wp-total']
      ? parseInt(ordersResponse.headers['x-wp-total'] as string)
      : ordersResponse.data?.length || 0;

    return {
      success: true,
      message: 'اتصال به WooCommerce موفق بود!',
      data: {
        productsCount: totalProducts,
        ordersCount: totalOrders,
        canReadProducts: true,
        canReadOrders: true,
      }
    };
  } catch (error: unknown) {
    console.error('WooCommerce connection error:', error);

    // Provide helpful error messages
    let errorMessage = 'خطا در اتصال به WooCommerce';
    const errorObj = error as { message?: string };
    if (errorObj.message?.includes('401') || errorObj.message?.includes('Unauthorized')) {
      errorMessage = 'خطا: کلیدهای API (Consumer Key/Secret) نامعتبر هستند';
    } else if (errorObj.message?.includes('404') || errorObj.message?.includes('Not Found')) {
      errorMessage = 'خطا: URL WooCommerce یافت نشد. لطفا URL را بررسی کنید';
    } else if (errorObj.message?.includes('ECONNREFUSED') || errorObj.message?.includes('ENOTFOUND')) {
      errorMessage = 'خطا: نمی‌توان به سرور WooCommerce متصل شد. URL را بررسی کنید';
    } else if (errorObj.message) {
      errorMessage = `خطا: ${errorObj.message}`;
    }

    return {
      success: false,
      message: errorMessage,
      data: {
        canReadProducts: false,
        canReadOrders: false,
      }
    };
  }
}

interface WooProduct {
  id: number | string;
  name?: string;
  price?: string | number;
  stock_quantity?: number;
  sku?: string;
  images?: Array<{ src?: string }>;
}

export async function syncProducts(): Promise<ActionResult<{ created: number; updated: number }>> {
  try {
    const wooCommerce = await getWooCommerceClient();

    // Fetch products from WooCommerce with pagination support
    let allProducts: WooProduct[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    console.log('[SYNC] Starting to fetch products from WooCommerce...');
    while (hasMore) {
      try {
        const response = await wooCommerce.get("products", {
          per_page: perPage,
          page: page
        });

        const products = response.data || [];
        console.log(`[SYNC] Page ${page}: Received ${products.length} products`);

        if (products.length > 0) {
          allProducts = allProducts.concat(products);
          hasMore = products.length === perPage; // If we got less than perPage, we're done
          page++;
        } else {
          hasMore = false;
        }
      } catch (pageError: unknown) {
        console.error(`[SYNC] Error fetching page ${page}:`, pageError);
        // If it's the first page and it fails, throw the error
        if (page === 1) {
          throw pageError;
        }
        // Otherwise, stop pagination
        hasMore = false;
      }
    }
    
    console.log(`[SYNC] Total products fetched: ${allProducts.length}`);
    const wooProducts = allProducts;

    let createdCount = 0;
    let updatedCount = 0;

    // Get warehouse ID from settings
    const warehouseId = await getWooWarehouseId();
    if (!warehouseId) {
      throw new Error('انبار WooCommerce تنظیم نشده است. لطفا در تنظیمات انبار را انتخاب کنید.');
    }

    for (const wooProduct of wooProducts) {
      // Convert wooProduct.id to number if it's a string
      const wooProductId = typeof wooProduct.id === 'string' ? parseInt(wooProduct.id) : wooProduct.id;
      
      // Debug: Log product structure to see images format
      if (wooProduct.images) {
        console.log(`[Sync] Product ${wooProduct.name} images structure:`, JSON.stringify(wooProduct.images, null, 2));
      }
      
      const existingProduct = await prisma.product.findUnique({
        where: { wooId: wooProductId },
      });

      if (existingProduct) {
        // Use WooCommerce image URL directly (Vercel doesn't support filesystem uploads)
        let imageUrl = existingProduct.image;
        if (wooProduct.images && Array.isArray(wooProduct.images) && wooProduct.images.length > 0) {
          const imageSrc = wooProduct.images[0]?.src;
          if (imageSrc) imageUrl = imageSrc;
        }

        // Update name and image from WooCommerce, but keep system price
        await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            name: wooProduct.name || existingProduct.name,
            image: imageUrl,
            // sellPrice intentionally NOT updated - system is the source of truth for price
          },
        });
        updatedCount++;

        // Push system price and inventory TO WooCommerce (system → Woo, not Woo → system)
        const systemInventory = await prisma.inventory.findUnique({
          where: { productId_warehouseId: { productId: existingProduct.id, warehouseId } },
        });
        try {
          await wooCommerce.put(`products/${wooProductId}`, {
            regular_price: Number(existingProduct.sellPrice).toString(),
            stock_quantity: systemInventory?.quantity ?? 0,
            manage_stock: true,
          });
        } catch (e) {
          console.error(`[Sync] Failed to push price/stock to WooCommerce for ${wooProduct.name}:`, e);
        }

        // If no inventory record yet in system, create it from WooCommerce data
        if (!systemInventory && wooProduct.stock_quantity != null) {
          await prisma.inventory.create({
            data: {
              productId: existingProduct.id,
              warehouseId,
              quantity: Number(wooProduct.stock_quantity) || 0,
            },
          });
        }
      } else {
        // Create new product
        // Check if SKU exists to avoid collision
        const sku = wooProduct.sku || `WOO-${wooProduct.id}`;
        const existingSku = await prisma.product.findUnique({
            where: { sku: sku }
        });

        if (!existingSku) {
             // Use WooCommerce image URL directly (Vercel doesn't support filesystem uploads)
             let imageUrl: string | undefined = undefined;
             console.log(`[Sync] Creating new product ${wooProduct.name} (ID: ${wooProductId}) - Checking for image...`);
             if (wooProduct.images && Array.isArray(wooProduct.images) && wooProduct.images.length > 0) {
               const imageData = wooProduct.images[0];
               const imageSrc = imageData?.src;
               console.log(`[Sync] Found image data for new product:`, {
                 hasImages: !!wooProduct.images,
                 imagesLength: wooProduct.images.length,
                 firstImageSrc: imageSrc
               });

               if (imageSrc) {
                 console.log(`[Sync] Using WooCommerce image URL for new product: ${imageSrc}`);
                 // Store WooCommerce image URL directly
                 imageUrl = imageSrc;
               }
             } else {
               console.log(`[Sync] No images found for new product ${wooProduct.name}`);
             }

             // Generate barcode for new product
             const { generateProductBarcode, ensureUniqueBarcode } = await import('@/lib/barcode-utils');
             const baseBarcode = generateProductBarcode(sku);
             const barcode = await ensureUniqueBarcode(baseBarcode);
             
             const newProduct = await prisma.product.create({
              data: {
                wooId: wooProductId,
                name: wooProduct.name || 'محصول بدون نام',
                sku: sku,
                barcode,
                sellPrice: Number(wooProduct.price) || 0,
                costPrice: 0, // Default
                image: imageUrl,
              },
            });
            createdCount++;

            // Sync Inventory for new product
            if (wooProduct.stock_quantity !== undefined && wooProduct.stock_quantity !== null) {
                const stockQuantity = Number(wooProduct.stock_quantity) || 0;
                await prisma.inventory.upsert({
                    where: {
                        productId_warehouseId: {
                            productId: newProduct.id,
                            warehouseId: warehouseId
                        }
                    },
                    update: {
                        quantity: stockQuantity
                    },
                    create: {
                        productId: newProduct.id,
                        warehouseId: warehouseId,
                        quantity: stockQuantity
                    }
                });
            }
        }
      }
    }

    try {
        revalidatePath('/dashboard/inventory');
    } catch (e) {
        // Ignore revalidate error in script context
    }
    return { success: true, message: 'سینک محصولات با موفقیت انجام شد.', data: { created: createdCount, updated: updatedCount } };
  } catch (error: unknown) {
    console.error("Error syncing products:", error);
    const errorObj = error as { message?: string; stack?: string; code?: string; response?: { data?: unknown } };
    console.error("Error details:", {
      message: errorObj.message,
      stack: errorObj.stack,
      code: errorObj.code,
      response: errorObj.response?.data,
    });

    // Provide more descriptive error messages
    let errorMessage = 'خطا در سینک محصولات';
    if (errorObj.message?.includes('warehouse') || errorObj.message?.includes('انبار')) {
      errorMessage = errorObj.message;
    } else if (errorObj.response?.data) {
      errorMessage = `خطای WooCommerce API: ${JSON.stringify(errorObj.response.data)}`;
    } else if (errorObj.message) {
      errorMessage = `خطا: ${errorObj.message}`;
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
}

interface WooOrder {
  id: number;
  number?: string;
  total?: string | number;
  discount_total?: string | number;
  status?: string;
  customer_id?: number;
  date_created?: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
  };
  line_items?: Array<{
    product_id: number | string;
    quantity?: number | string;
    price?: number | string;
    total?: number | string;
    subtotal?: number | string;
    sku?: string;
  }>;
}

export async function processWooOrders(wooOrders: WooOrder[]) {
    let createdCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const debugLogs: string[] = []; // Store debug logs to return

    console.log(`[PROCESS] شروع پردازش ${wooOrders.length} سفارش از WooCommerce...`);
    let processedCount = 0;
    let existingOrdersCount = 0;
    let noItemsCount = 0;
    let invalidTotalCount = 0;
    let existingTransactionCount = 0;
    let emptyLineItemsCount = 0;

    for (const order of wooOrders) {
        // Debug: Log first order structure
        if (processedCount === 0) {
            console.log(`[PROCESS] ساختار سفارش اول:`, {
                id: order.id,
                number: order.number,
                hasLineItems: !!order.line_items,
                lineItemsLength: (order.line_items || []).length,
                lineItemsType: typeof order.line_items,
                lineItemsIsArray: Array.isArray(order.line_items)
            });
        }
        try {
            processedCount++;
            const existingOrder = await prisma.order.findUnique({
                where: { wooId: order.id }
            });

            if (existingOrder) {
                console.log(`[PROCESS] 🔄 سفارش WooCommerce #${order.number} (ID: ${order.id}) قبلا ثبت شده - بررسی تغییرات...`);

                // Check if order status changed from pending to completed
                const wasNotCompleted = existingOrder.status !== 'COMPLETED';
                const isNowCompleted = order.status === 'completed';
                const needsCompletion = wasNotCompleted && isNowCompleted;

                if (needsCompletion) {
                    console.log(`[PROCESS] 🎯 سفارش #${order.number} از ${existingOrder.status} به completed تغییر کرد - ایجاد تراکنش...`);

                    try {
                        // Get account from WooCommerce settings
                        const wooSettings = await getWooSettings();
                        let account = undefined;

                        if (wooSettings?.accountId) {
                            account = await prisma.account.findUnique({
                                where: { id: wooSettings.accountId }
                            });
                        }

                        if (!account) {
                            // Fallback to first account
                            account = await prisma.account.findFirst({
                                where: {
                                    type: {
                                        in: ['BANK', 'CASH']
                                    }
                                }
                            });
                        }

                        if (!account) {
                            console.error(`[PROCESS] ❌ حساب بانکی برای سفارش #${order.number} یافت نشد - skip می‌شود`);
                        } else {
                            await prisma.$transaction(async (tx) => {
                            const orderTotal = Number(order.total) || 0;

                            // Create transaction
                            const transaction = await tx.transaction.create({
                                data: {
                                    type: TransactionType.INCOME,
                                    amount: new Prisma.Decimal(orderTotal),
                                    currency: 'TOMAN',
                                    rateSnapshot: new Prisma.Decimal(1),
                                    amountInToman: new Prisma.Decimal(orderTotal),
                                    description: `سفارش WooCommerce #${order.number} - تکمیل شده`,
                                    category: 'Sales',
                                    accountId: account.id,
                                    wooId: order.id,
                                    wooStatus: order.status || 'completed',
                                    date: new Date(order.date_created || Date.now())
                                }
                            });

                            // Update order to completed
                            await tx.order.update({
                                where: { id: existingOrder.id },
                                data: {
                                    status: 'COMPLETED',
                                    paymentStatus: 'PAID',
                                    paidAmount: new Prisma.Decimal(orderTotal),
                                    transactionId: transaction.id
                                }
                            });

                            // Update account balance
                            await tx.account.update({
                                where: { id: account.id },
                                data: {
                                    balance: {
                                        increment: new Prisma.Decimal(orderTotal)
                                    }
                                }
                            });
                        });

                        console.log(`[PROCESS] ✅ سفارش #${order.number} تکمیل شد و تراکنش ایجاد شد`);
                        updatedCount++;
                        }
                        skippedCount++;
                        existingOrdersCount++;
                        continue;
                    } catch (completionError) {
                        console.error(`[PROCESS] ❌ خطا در تکمیل سفارش #${order.number}:`, completionError);
                    }
                }

                // Check if there are missing items that can now be added
                let addedMissingItems = false;

                try {
                    // Get existing order items
                    const existingOrderWithItems = await prisma.order.findUnique({
                        where: { id: existingOrder.id },
                        include: { items: { include: { product: true } } }
                    });

                    if (order.line_items && order.line_items.length > 0 && existingOrderWithItems) {
                        const existingProductWooIds = new Set(
                            existingOrderWithItems.items
                                .map((item: any) => item.product?.wooId)
                                .filter((id: any) => id != null)
                        );

                        // Check each WooCommerce line item
                        for (const item of order.line_items) {
                            const productIdToSearch = typeof item.product_id === 'string'
                                ? parseInt(item.product_id)
                                : Number(item.product_id);

                            // Skip if already in order or invalid
                            if (isNaN(productIdToSearch) || existingProductWooIds.has(productIdToSearch)) {
                                continue;
                            }

                            // Try to find product in database
                            const orConditions: Array<{ wooId?: number; sku?: string }> = [
                                { wooId: productIdToSearch }
                            ];
                            if (item.sku) {
                                orConditions.push({ sku: item.sku });
                            }

                            const product = await prisma.product.findFirst({
                                where: { OR: orConditions }
                            });

                            // If product exists now, add it to the order
                            if (product) {
                                const itemQuantity = Number(item.quantity) || 0;
                                let itemPrice = Number(item.price) || 0;
                                const itemTotal = Number(item.total) || Number(item.subtotal) || 0;

                                if (itemPrice === 0 && itemQuantity > 0) {
                                    itemPrice = itemTotal / itemQuantity;
                                }

                                if (itemPrice > 0 && itemQuantity > 0) {
                                    // Add missing item to order
                                    const wooWhId = await getWooWarehouseId();
                                    await prisma.orderItem.create({
                                        data: {
                                            orderId: existingOrder.id,
                                            productId: product.id,
                                            quantity: itemQuantity,
                                            price: new Prisma.Decimal(itemPrice),
                                            warehouseId: wooWhId || undefined,
                                        }
                                    });

                                    console.log(`[PROCESS] ✅ آیتم گمشده اضافه شد: ${product.name} به سفارش #${order.number}`);
                                    addedMissingItems = true;
                                }
                            }
                        }

                        if (addedMissingItems) {
                            console.log(`[PROCESS] ✨ سفارش #${order.number} با آیتم‌های جدید به‌روز شد`);
                        } else {
                            console.log(`[PROCESS] ⊘ سفارش #${order.number} آیتم گمشده‌ای برای افزودن ندارد`);
                        }
                    }
                } catch (updateError) {
                    console.error(`[PROCESS] ❌ خطا در به‌روزرسانی سفارش #${order.number}:`, updateError);
                }

                skippedCount++;
                existingOrdersCount++;
                continue;
            }
            
            console.log(`[PROCESS] پردازش سفارش جدید WooCommerce #${order.number} (ID: ${order.id})... (${processedCount}/${wooOrders.length})`);
            // 1. Find or Create Customer
            let customerId: string | undefined = undefined;
            if (order.billing?.email || order.billing?.phone || order.billing?.first_name) {
                // Try to find existing customer by email or wooId
                let existingCustomer = undefined;
                if (order.billing?.email) {
                    existingCustomer = await prisma.customer.findFirst({
                        where: {
                            OR: [
                                { email: order.billing.email },
                                { wooId: order.customer_id && order.customer_id !== 0 ? order.customer_id : undefined }
                            ]
                        }
                    });
                }

                if (existingCustomer) {
                    customerId = existingCustomer.id;
                    // Update wooId if missing
                    if (!existingCustomer.wooId && order.customer_id && order.customer_id !== 0) {
                            await prisma.customer.update({
                            where: { id: existingCustomer.id },
                            data: { wooId: order.customer_id }
                            });
                    }
                } else {
                    // Generate customer name with priority: full name > email > phone > order number
                    let customerName = `${order.billing.first_name || ''} ${order.billing.last_name || ''}`.trim();

                    if (!customerName && order.billing.email) {
                        customerName = order.billing.email;
                    } else if (!customerName && order.billing.phone) {
                        customerName = order.billing.phone;
                    } else if (!customerName) {
                        customerName = `مشتری سفارش #${order.number || order.id}`;
                    }

                    const newCustomer = await prisma.customer.create({
                        data: {
                            name: customerName,
                            email: order.billing?.email || undefined,
                            phone: order.billing?.phone || undefined,
                            address: [
                                order.billing?.address_1,
                                order.billing?.address_2,
                                order.billing?.city,
                                order.billing?.state,
                                order.billing?.postcode
                            ].filter(Boolean).join(', ') || undefined,
                            wooId: order.customer_id && order.customer_id !== 0 ? order.customer_id : undefined
                        }
                    });
                    customerId = newCustomer.id;
                }
            }

            // 2. Create Order and OrderItems
            const orderItemsData: { productId: string; quantity: number; price: number }[] = [];
            let foundProductsCount = 0;
            let notFoundProductsCount = 0;
            
            // Debug: Check if line_items exists
            if (order === wooOrders[0]) {
                console.log(`[PROCESS] سفارش #${order.number}: line_items exists: ${!!order.line_items}, length: ${(order.line_items || []).length}`);
                if (order.line_items && order.line_items.length > 0) {
                    console.log(`[PROCESS] اولین آیتم: product_id=${order.line_items[0].product_id}, sku=${order.line_items[0].sku || 'null'}`);
                } else {
                    console.log(`[PROCESS] سفارش #${order.number}: line_items خالی است یا وجود ندارد!`);
                    emptyLineItemsCount++;
                }
            }
            
            // Check if line_items is empty
            if (!order.line_items || order.line_items.length === 0) {
                emptyLineItemsCount++;
                if (order === wooOrders[0]) {
                    console.log(`[PROCESS] سفارش #${order.number}: هیچ line_items ندارد!`);
                }
                continue; // Skip this order
            }
            
            for (const item of order.line_items) {
                // Find product by wooId or SKU
                // Note: item.product_id might be a string, so we need to convert it
                // Use EXACT same conversion logic as debugProductMatching
                const productIdToSearch = typeof item.product_id === 'string' ? parseInt(item.product_id) : Number(item.product_id);
                
                // Skip if productIdToSearch is NaN or invalid
                if (isNaN(productIdToSearch) || productIdToSearch <= 0) {
                    console.warn(`[PROCESS] product_id نامعتبر برای سفارش #${order.number}: ${item.product_id}`);
                    notFoundProductsCount++;
                    continue;
                }
                
                // Debug: Log first few searches (only for first order)
                if (order === wooOrders[0] && (notFoundProductsCount + foundProductsCount) < 3) {
                    const logMsg = `[PROCESS] جستجوی محصول برای سفارش #${order.number}: product_id=${item.product_id} (type: ${typeof item.product_id}), productIdToSearch=${productIdToSearch}, sku=${item.sku || 'null'}`;
                    console.log(logMsg);
                    debugLogs.push(logMsg);
                }
                
                // Find product by wooId or SKU (same logic as debugProductMatching)
                // Build OR conditions - only add sku if it exists
                const orConditions: Array<{ wooId?: number; sku?: string }> = [
                    { wooId: productIdToSearch }
                ];

                if (item.sku) {
                    orConditions.push({ sku: item.sku });
                }
                
                const product = await prisma.product.findFirst({
                    where: {
                        OR: orConditions
                    }
                });
                
                // Debug: Log result (only for first order)
                if (order === wooOrders[0] && (notFoundProductsCount + foundProductsCount) < 3) {
                    if (product) {
                        const logMsg = `[PROCESS] ✓ محصول یافت شد: wooId=${product.wooId}, sku=${product.sku}, name=${product.name}`;
                        console.log(logMsg);
                        debugLogs.push(logMsg);
                    } else {
                        const logMsg1 = `[PROCESS] ✗ محصول یافت نشد برای product_id=${item.product_id}, productIdToSearch=${productIdToSearch}`;
                        console.log(logMsg1);
                        debugLogs.push(logMsg1);
                        // Try direct query to see what's in database
                        const directQuery = await prisma.product.findFirst({
                            where: { wooId: productIdToSearch }
                        });
                        const logMsg2 = `[PROCESS] جستجوی مستقیم با wooId=${productIdToSearch}: ${directQuery ? `یافت شد (wooId=${directQuery.wooId})` : 'یافت نشد'}`;
                        console.log(logMsg2);
                        debugLogs.push(logMsg2);
                    }
                }

                if (product) {
                    foundProductsCount++;
                    // In WooCommerce, price might be in item.price, item.total, or item.subtotal
                    // item.price is usually the unit price, but if undefined, calculate from total
                    const itemQuantity = Number(item.quantity) || 0;
                    let itemPrice = Number(item.price) || 0;
                    const itemTotal = Number(item.total) || Number(item.subtotal) || 0;
                    
                    // If price is not available, calculate from total or subtotal
                    if (itemPrice === 0 && itemQuantity > 0) {
                        itemPrice = itemTotal / itemQuantity;
                    }
                    
                    // Debug: Log price and quantity (only for first order)
                    if (order === wooOrders[0] && foundProductsCount <= 3) {
                        const logMsg = `[PROCESS] محصول یافت شد: price=${item.price}, total=${item.total}, subtotal=${item.subtotal} -> itemPrice=${itemPrice}, quantity=${itemQuantity}`;
                        console.log(logMsg);
                        debugLogs.push(logMsg);
                    }
                    
                    if (itemPrice > 0 && itemQuantity > 0) {
                        orderItemsData.push({
                            productId: product.id,
                            quantity: itemQuantity,
                            price: itemPrice
                        });
                        // Debug: Log when item is added
                        if (order === wooOrders[0] && orderItemsData.length <= 3) {
                            const logMsg = `[PROCESS] ✓ آیتم به orderItemsData اضافه شد: productId=${product.id}, quantity=${itemQuantity}, price=${itemPrice}`;
                            console.log(logMsg);
                            debugLogs.push(logMsg);
                        }
                    } else {
                        const warnMsg = `[PROCESS] ⚠ آیتم سفارش WooCommerce (product_id: ${item.product_id}) قیمت یا تعداد نامعتبر دارد: price=${itemPrice}, quantity=${itemQuantity}, total=${itemTotal}`;
                        console.warn(warnMsg);
                        if (order === wooOrders[0] && notFoundProductsCount < 3) {
                            debugLogs.push(warnMsg);
                        }
                    }
                } else {
                    notFoundProductsCount++;
                    // Check if product exists with different wooId or sku (only for first missing product)
                    if (notFoundProductsCount === 1) {
                        console.log(`[PROCESS] محصول WooCommerce با ID ${item.product_id} (type: ${typeof item.product_id}) یا SKU ${item.sku || 'null'} در سیستم یافت نشد.`);
                        
                        // Try to find by exact match
                        const exactMatch = await prisma.product.findFirst({
                            where: { wooId: productIdToSearch }
                        });
                        const exactMatchBySku = item.sku ? await prisma.product.findFirst({
                            where: { sku: item.sku }
                        }) : undefined;
                        
                        console.log(`[PROCESS] جستجوی دقیق: wooId=${item.product_id} -> ${exactMatch ? 'یافت شد' : 'یافت نشد'}, sku=${item.sku || 'null'} -> ${exactMatchBySku ? 'یافت شد' : 'یافت نشد'}`);
                        
                        // Show sample products
                        const allProducts = await prisma.product.findMany({
                            where: { wooId: { not: null } },
                            take: 5,
                            select: { id: true, wooId: true, sku: true, name: true }
                        });
                        console.log(`[PROCESS] نمونه محصولات موجود در سیستم:`, allProducts.map((p: any) => ({ id: p.id, wooId: p.wooId, sku: p.sku, name: p.name })));
                    }
                }
            }
            
            if (orderItemsData.length === 0) {
                if ((order.line_items || []).length > 0) {
                    console.log(`[PROCESS] سفارش #${order.number}: ${foundProductsCount} محصول یافت شد، ${notFoundProductsCount} محصول یافت نشد از ${(order.line_items || []).length} آیتم کل`);
                } else {
                    console.log(`[PROCESS] سفارش #${order.number}: هیچ line_items ندارد!`);
                }
            }

            // 3. Create Transaction (Financial Record)
            // Get account from WooCommerce settings, fallback to first account
            const wooSettings = await getWooSettings();
            let account = undefined;
            
            if (wooSettings?.accountId) {
                account = await prisma.account.findUnique({
                    where: { id: wooSettings.accountId }
                });
            }
            
            if (!account) {
                account = await prisma.account.findFirst();
            }
            
            if (!account) {
                throw new Error('هیچ حسابی در سیستم یافت نشد. لطفا ابتدا یک حساب ایجاد کنید.');
            }

            // Check if order has items
            if (orderItemsData.length === 0) {
                noItemsCount++;
                console.warn(`[PROCESS] سفارش WooCommerce #${order.number} (ID: ${order.id}) هیچ آیتمی ندارد یا محصولات آن در سیستم یافت نشد. (${noItemsCount} سفارش بدون آیتم)`);
                errors.push(`سفارش #${order.number}: محصولات یافت نشد`);
                continue;
            }

            try {
                     // Validate and prepare order data
                     const orderTotal = Number(order.total) || 0;
                     const orderDiscount = Number(order.discount_total || 0);
                     
                     console.log(`[DEBUG] سفارش #${order.number}: orderTotal=${orderTotal}, orderDiscount=${orderDiscount}, orderItemsData.length=${orderItemsData.length}`);
                     
                     if (orderTotal <= 0) {
                         invalidTotalCount++;
                         console.warn(`[PROCESS] سفارش WooCommerce #${order.number} (ID: ${order.id}) مبلغ نامعتبر دارد: ${order.total} (${invalidTotalCount} سفارش با مبلغ نامعتبر)`);
                         errors.push(`سفارش #${order.number}: مبلغ نامعتبر`);
                         continue;
                     }

                     // Check if transaction already exists
                     const existingTransaction = await prisma.transaction.findUnique({
                         where: { wooId: order.id }
                     });
                     
                     if (existingTransaction) {
                         existingTransactionCount++;
                         console.log(`[PROCESS] تراکنش برای سفارش WooCommerce #${order.number} (ID: ${order.id}) قبلاً وجود دارد. (${existingTransactionCount} تراکنش تکراری)`);
                         errors.push(`سفارش #${order.number}: تراکنش قبلاً ثبت شده است`);
                         continue;
                     }

                     // Use a transaction to ensure atomicity
                     await prisma.$transaction(async (tx: any) => {
                        console.log(`[DEBUG] ایجاد تراکنش برای سفارش #${order.number}...`);
                        
                        // Get customer name for description
                        let customerName = 'مشتری آنلاین';
                        if (customerId) {
                            const customer = await tx.customer.findUnique({
                                where: { id: customerId },
                                select: { name: true }
                            });
                            if (customer) {
                                customerName = customer.name;
                            }
                        }

                        // Determine payment status based on WooCommerce order status
                        const isCompleted = order.status === 'completed';
                        const paidAmount = isCompleted ? orderTotal : 0;
                        const paymentStatus = isCompleted ? 'PAID' : 'UNPAID';

                        let transactionId = undefined;

                        // Create Transaction ONLY for completed orders
                        if (isCompleted) {
                            const transaction = await tx.transaction.create({
                                data: {
                                    type: TransactionType.INCOME,
                                    amount: new Prisma.Decimal(orderTotal),
                                    currency: 'TOMAN',
                                    rateSnapshot: new Prisma.Decimal(1),
                                    amountInToman: new Prisma.Decimal(orderTotal),
                                    description: `سفارش WooCommerce #${order.number} - مشتری: ${customerName}`,
                                    category: 'Sales',
                                    accountId: account.id,
                                    wooId: order.id,
                                    wooStatus: order.status || 'completed',
                                    date: new Date(order.date_created || Date.now())
                                }
                            });
                            transactionId = transaction.id;
                            console.log(`[DEBUG] تراکنش ایجاد شد: ${transaction.id}`);
                        } else {
                            console.log(`[DEBUG] سفارش pending است - تراکنش ایجاد نمی‌شود`);
                        }

                        // Resolve WooCommerce warehouse ID once; persist it on each OrderItem
                        const wooWarehouseId = await getWooWarehouseId();

                        // Create Order linked to Transaction
                        console.log(`[DEBUG] ایجاد سفارش برای سفارش WooCommerce #${order.number}...`);
                        const createdOrder = await tx.order.create({
                            data: {
                                wooId: order.id,
                                customerId: customerId,
                                totalAmount: new Prisma.Decimal(orderTotal),
                                discount: new Prisma.Decimal(orderDiscount),
                                paidAmount: new Prisma.Decimal(paidAmount),
                                paymentStatus: paymentStatus,
                                status: isCompleted ? 'COMPLETED' : 'PENDING',
                                transactionId: transactionId,
                                createdAt: new Date(order.date_created || Date.now()),
                                items: {
                                    create: orderItemsData.map((item: any) => ({
                                        productId: item.productId,
                                        quantity: item.quantity,
                                        price: new Prisma.Decimal(item.price),
                                        warehouseId: wooWarehouseId || undefined,
                                    }))
                                }
                            }
                        });
                        console.log(`[DEBUG] سفارش ایجاد شد: ${createdOrder.id}, number: ${createdOrder.number}`);

                        // Update Account Balance ONLY for completed orders
                        if (isCompleted) {
                            await tx.account.update({
                                where: { id: account.id },
                                data: {
                                    balance: {
                                        increment: new Prisma.Decimal(orderTotal)
                                    }
                                }
                            });
                        }

                        // 4. Deduct Inventory for each order item
                        const warehouseId = wooWarehouseId;
                        if (warehouseId) {
                            for (const item of orderItemsData) {
                                // Find inventory for this product in the WooCommerce warehouse
                                const inventory = await tx.inventory.findFirst({
                                    where: {
                                        productId: item.productId,
                                        warehouseId: warehouseId,
                                        quantity: { gte: item.quantity }
                                    }
                                });

                                if (inventory) {
                                    await tx.inventory.update({
                                        where: {
                                            productId_warehouseId: {
                                                productId: item.productId,
                                                warehouseId: warehouseId
                                            }
                                        },
                                        data: {
                                            quantity: { decrement: item.quantity }
                                        }
                                    });
                                } else {
                                    console.warn(`موجودی کافی برای محصول ${item.productId} در انبار WooCommerce وجود ندارد.`);
                                }
                            }
                        }
                     });
                    createdCount++;
                    console.log(`✓ سفارش WooCommerce #${order.number} (ID: ${order.id}) با موفقیت ثبت شد.`);
                    
                    // Revalidate paths after each successful order creation
                    try {
                        revalidatePath('/dashboard/accounting');
                        revalidatePath('/dashboard/sales');
                        revalidatePath('/dashboard/sales/history');
                        revalidatePath('/dashboard/inventory');
                    } catch (e) {
                        // Ignore revalidate error in script context
                    }
                } catch (txError: unknown) {
                    const txErrorObj = txError as { message?: string };
                    console.error(`✗ خطا در ثبت سفارش WooCommerce #${order.number} (ID: ${order.id}):`, txError);
                    errorCount++;
                    errors.push(`سفارش #${order.number}: ${txErrorObj.message || 'خطای نامشخص'}`);
                }
        } catch (error: unknown) {
            const errorObj = error as { message?: string };
            console.error(`خطا در پردازش سفارش WooCommerce (ID: ${order.id}):`, error);
            errorCount++;
            errors.push(`سفارش ID ${order.id}: ${errorObj.message || 'خطای نامشخص'}`);
        }
    }
    
    console.log(`[PROCESS] پایان پردازش: ${createdCount} ثبت شد، ${skippedCount} رد شد، ${errorCount} خطا`);
    console.log(`[PROCESS] آمار تفصیلی: ${processedCount} پردازش شد، ${existingOrdersCount} سفارش تکراری، ${emptyLineItemsCount} بدون line_items، ${noItemsCount} بدون آیتم، ${invalidTotalCount} مبلغ نامعتبر، ${existingTransactionCount} تراکنش تکراری`);
    
    return { 
        createdCount, 
        skippedCount, 
        errorCount, 
        errors,
        debugLogs: debugLogs.slice(0, 20), // Return first 20 debug logs
        stats: {
            processed: processedCount,
            existingOrders: existingOrdersCount,
            emptyLineItems: emptyLineItemsCount,
            noItems: noItemsCount,
            invalidTotal: invalidTotalCount,
            existingTransactions: existingTransactionCount
        }
    };
}

export async function syncOrders(): Promise<ActionResult<{
  created: number;
  skipped: number;
  totalOrders: number;
  totalOrdersInWooCommerce?: number;
  errorCount?: number;
  errors?: string[];
  stats?: {
    processed: number;
    existingOrders: number;
    emptyLineItems: number;
    noItems: number;
    invalidTotal: number;
    existingTransactions: number;
  };
  debugLogs?: string[];
}>> {
    console.log('[SERVER] syncOrders شروع شد');
    try {
        console.log('[SERVER] دریافت WooCommerce client...');
        const wooCommerce = await getWooCommerceClient();
        console.log('[SERVER] WooCommerce client دریافت شد');

        // Get total orders count first
        console.log('[SERVER] دریافت تعداد کل سفارشات...');
        const testResponse = await wooCommerce.get("orders", { per_page: 1 });
        const totalOrders = testResponse.headers?.['x-wp-total']
            ? parseInt(testResponse.headers['x-wp-total'] as string)
            : 0;

        console.log(`[SERVER] تعداد کل سفارشات در WooCommerce: ${totalOrders}`);

        // Fetch orders in batches (WooCommerce default is 10 per page, max 100)
        const perPage = 100;
        const totalPages = Math.ceil(totalOrders / perPage);
        let allOrders: WooOrder[] = [];
        
        console.log(`[SERVER] در حال دریافت ${totalPages} صفحه سفارشات...`);
        for (let page = 1; page <= totalPages; page++) {
            const response = await wooCommerce.get("orders", { 
                per_page: perPage,
                page: page
            });
            if (response.data && response.data.length > 0) {
                allOrders = allOrders.concat(response.data);
                console.log(`[SERVER] صفحه ${page}/${totalPages}: ${response.data.length} سفارش دریافت شد`);
            }
        }

        console.log(`[SERVER] در حال پردازش ${allOrders.length} سفارش از WooCommerce...`);
        
        if (allOrders.length === 0) {
            console.log('[SERVER] هشدار: هیچ سفارشی از WooCommerce دریافت نشد!');
            return {
                success: true,
                message: 'هیچ سفارشی از WooCommerce دریافت نشد. لطفا اتصال را بررسی کنید.',
                data: {
                    created: 0,
                    skipped: 0,
                    totalOrders: 0,
                }
            };
        }
        
        const result = await processWooOrders(allOrders);
        
        console.log(`[SERVER] نتیجه پردازش: ${result.createdCount} ثبت شد، ${result.skippedCount} رد شد، ${result.errorCount} خطا`);
        
        try {
            revalidatePath('/dashboard/accounting');
            revalidatePath('/dashboard/sales');
            revalidatePath('/dashboard/inventory');
        } catch (e) {
            // Ignore revalidate error in script context
        }
        
        let message = '';
        if (result.createdCount > 0) {
            message += `${result.createdCount} سفارش جدید ثبت شد. `;
        }
        if (result.skippedCount > 0) {
            message += `${result.skippedCount} سفارش قبلا ثبت شده بود. `;
        }
        if (result.errorCount > 0) {
            message += `${result.errorCount} خطا رخ داد.`;
        }
        if (!message) {
            message = 'هیچ سفارش جدیدی یافت نشد.';
        }
        
        // Return detailed result for debugging
        const returnValue: ActionResult<{
          created: number;
          skipped: number;
          totalOrders: number;
          totalOrdersInWooCommerce?: number;
          errorCount?: number;
          errors?: string[];
          stats?: {
            processed: number;
            existingOrders: number;
            emptyLineItems: number;
            noItems: number;
            invalidTotal: number;
            existingTransactions: number;
          };
          debugLogs?: string[];
        }> = {
            success: true,
            message: message.trim(),
            data: {
                created: result.createdCount,
                skipped: result.skippedCount,
                totalOrders: allOrders.length,
                totalOrdersInWooCommerce: totalOrders,
                stats: result.stats || {
                  processed: 0,
                  existingOrders: 0,
                  emptyLineItems: 0,
                  noItems: 0,
                  invalidTotal: 0,
                  existingTransactions: 0
                },
                debugLogs: result.debugLogs || []
            }
        };

        if (result.errorCount > 0) {
            returnValue.data!.errors = result.errors;
            returnValue.data!.errorCount = result.errorCount;
        }

        console.log('[SERVER] نتیجه نهایی syncOrders:', returnValue);
        return returnValue;

    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error syncing orders:", error);
        return {
            success: false,
            message: `خطا در سینک سفارش‌ها: ${errorObj.message || 'خطای نامشخص'}`,
            data: {
                created: 0,
                skipped: 0,
                totalOrders: 0,
            }
        };
    }
}

// Update product price in WooCommerce
export async function updateProductPriceInWooCommerce(productId: string, newPrice: number): Promise<ActionResult<{ updated: boolean }>> {
    try {
        // Get product from database
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { wooId: true, name: true, sku: true }
        });

        if (!product || !product.wooId) {
            return {
                success: true,
                message: 'محصول WooCommerce ID ندارد. فقط در سیستم ذخیره شد.',
                data: { updated: false }
            };
        }

        const wooCommerce = await getWooCommerceClient();

        // Update price in WooCommerce
        await wooCommerce.put(`products/${product.wooId}`, {
            regular_price: newPrice.toString()
        });

        console.log(`[WooCommerce] قیمت محصول ${product.name} (WooID: ${product.wooId}) به ${newPrice} تومان آپدیت شد`);

        return {
            success: true,
            message: 'قیمت محصول در WooCommerce به‌روزرسانی شد.',
            data: { updated: true }
        };
    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error updating price in WooCommerce:", error);
        return {
            success: false,
            message: `خطا در به‌روزرسانی قیمت در WooCommerce: ${errorObj.message || 'خطای نامشخص'}`,
            data: { updated: false }
        };
    }
}

// Update product stock in WooCommerce
export async function updateProductStockInWooCommerce(productId: string, warehouseId: string, newQuantity: number): Promise<ActionResult<{ updated: boolean }>> {
    try {
        // Get product from database
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { wooId: true, name: true, sku: true }
        });

        if (!product || !product.wooId) {
            return {
                success: true,
                message: 'محصول WooCommerce ID ندارد. فقط در سیستم ذخیره شد.',
                data: { updated: false }
            };
        }

        // Check if this is the WooCommerce warehouse
        const wooWarehouseId = await getWooWarehouseId();
        if (warehouseId !== wooWarehouseId) {
            return {
                success: true,
                message: 'این انبار مربوط به WooCommerce نیست. فقط در سیستم ذخیره شد.',
                data: { updated: false }
            };
        }

        const wooCommerce = await getWooCommerceClient();

        // Update stock in WooCommerce
        await wooCommerce.put(`products/${product.wooId}`, {
            stock_quantity: newQuantity,
            manage_stock: true
        });

        console.log(`[WooCommerce] موجودی محصول ${product.name} (WooID: ${product.wooId}) به ${newQuantity} عدد آپدیت شد`);

        return {
            success: true,
            message: 'موجودی محصول در WooCommerce به‌روزرسانی شد.',
            data: { updated: true }
        };
    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error updating stock in WooCommerce:", error);
        return {
            success: false,
            message: `خطا در به‌روزرسانی موجودی در WooCommerce: ${errorObj.message || 'خطای نامشخص'}`,
            data: { updated: false }
        };
    }
}

// Cancel order in WooCommerce
export async function cancelOrderInWooCommerce(wooOrderId: number): Promise<ActionResult<{ cancelled: boolean }>> {
    try {
        const wooCommerce = await getWooCommerceClient();

        // Update order status to cancelled in WooCommerce
        await wooCommerce.put(`orders/${wooOrderId}`, {
            status: 'cancelled'
        });

        console.log(`[WooCommerce] سفارش با ID ${wooOrderId} در WooCommerce لغو شد`);

        return {
            success: true,
            message: 'سفارش در WooCommerce لغو شد.',
            data: { cancelled: true }
        };
    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error cancelling order in WooCommerce:", error);
        return {
            success: false,
            message: `خطا در لغو سفارش در WooCommerce: ${errorObj.message || 'خطای نامشخص'}`,
            data: { cancelled: false }
        };
    }
}

// Complete order in WooCommerce (mark as completed)
export async function completeOrderInWooCommerce(wooOrderId: number): Promise<ActionResult<{ completed: boolean }>> {
    try {
        const wooCommerce = await getWooCommerceClient();

        // Update order status to completed in WooCommerce
        await wooCommerce.put(`orders/${wooOrderId}`, {
            status: 'completed'
        });

        console.log(`[WooCommerce] سفارش با ID ${wooOrderId} در WooCommerce به تکمیل شده تغییر کرد`);

        return {
            success: true,
            message: 'سفارش در WooCommerce به تکمیل شده تغییر کرد.',
            data: { completed: true }
        };
    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error completing order in WooCommerce:", error);
        return {
            success: false,
            message: `خطا در تکمیل سفارش در WooCommerce: ${errorObj.message || 'خطای نامشخص'}`,
            data: { completed: false }
        };
    }
}


// Debug function to check product matching
export async function debugProductMatching(): Promise<ActionResult<{
  orderInfo?: {
    orderNumber?: string;
    orderId?: number;
    itemProductId?: number | string;
    itemProductIdType?: string;
    itemSku?: string;
    productIdToSearch?: number;
  };
  productsInDatabase?: Array<{
    id: string;
    wooId?: number;
    sku: string;
    name: string;
  }>;
  foundProduct?: {
    id: string;
    wooId?: number;
    sku: string;
    name: string;
  };
}>> {
    try {
        const wooCommerce = await getWooCommerceClient();

        // Get first order
        const ordersResponse = await wooCommerce.get("orders", { per_page: 1 });
        if (!ordersResponse.data || ordersResponse.data.length === 0) {
            return { success: false, message: 'هیچ سفارشی در WooCommerce یافت نشد.' };
        }

        const firstOrder = ordersResponse.data[0];
        const firstItem = firstOrder.line_items?.[0];

        if (!firstItem) {
            return { success: false, message: 'سفارش اول هیچ آیتمی ندارد.' };
        }

        // Get products from database
        const productsWithWooId = await prisma.product.findMany({
            where: { wooId: { not: null } },
            take: 5,
            select: { id: true, wooId: true, sku: true, name: true }
        });

        // Try to find product
        const productIdToSearch = typeof firstItem.product_id === 'string' ? parseInt(firstItem.product_id) : Number(firstItem.product_id);
        const foundProduct = await prisma.product.findFirst({
            where: {
                OR: [
                    { wooId: productIdToSearch },
                    { sku: firstItem.sku || undefined }
                ]
            }
        });

        return {
            success: true,
            message: foundProduct ? 'محصول یافت شد!' : 'محصول یافت نشد!',
            data: {
                orderInfo: {
                    orderNumber: firstOrder.number,
                    orderId: firstOrder.id,
                    itemProductId: firstItem.product_id,
                    itemProductIdType: typeof firstItem.product_id,
                    itemSku: firstItem.sku,
                    productIdToSearch: productIdToSearch
                },
                productsInDatabase: productsWithWooId.map((p: any) => ({
                    id: p.id,
                    wooId: p.wooId ?? undefined,
                    sku: p.sku,
                    name: p.name
                })),
                foundProduct: foundProduct ? {
                    id: foundProduct.id,
                    wooId: foundProduct.wooId ?? undefined,
                    sku: foundProduct.sku,
                    name: foundProduct.name
                } : undefined,
            }
        };
    } catch (error: unknown) {
        const errorObj = error as { message?: string };
        console.error("Error in debugProductMatching:", error);
        return {
            success: false,
            message: `خطا: ${errorObj.message || 'خطای نامشخص'}`,
        };
    }
}

/**
 * سینک خودکار WooCommerce
 * ابتدا محصولات و سپس سفارشات را سینک می‌کند
 */
export async function performAutoSync(): Promise<ActionResult<{
  productsResult?: any;
  ordersResult?: any;
}>> {
  try {
    console.log('[AUTO-SYNC] شروع سینک خودکار WooCommerce...');

    // 1. Sync Products First
    console.log('[AUTO-SYNC] مرحله 1: سینک محصولات...');
    const productsResult = await syncProducts();

    if (!productsResult.success) {
      console.error('[AUTO-SYNC] خطا در سینک محصولات:', productsResult.error);
      return {
        success: false,
        message: `خطا در سینک محصولات: ${productsResult.error}`,
        data: {
          productsResult,
        },
      };
    }

    console.log('[AUTO-SYNC] سینک محصولات موفق:', {
      created: productsResult.data?.created,
      updated: productsResult.data?.updated,
    });

    // 2. Sync Orders Second
    console.log('[AUTO-SYNC] مرحله 2: سینک سفارشات...');
    const ordersResult = await syncOrders();

    if (!ordersResult.success) {
      console.error('[AUTO-SYNC] خطا در سینک سفارشات:', ordersResult.message);
      return {
        success: false,
        message: `محصولات سینک شدند ولی خطا در سینک سفارشات: ${ordersResult.message}`,
        data: {
          productsResult,
          ordersResult,
        },
      };
    }

    console.log('[AUTO-SYNC] سینک سفارشات موفق:', {
      created: ordersResult.data?.created,
      skipped: ordersResult.data?.skipped,
    });

    // Update last sync time
    const { updateLastSyncTime } = await import('./woocommerce-settings');
    await updateLastSyncTime();

    console.log('[AUTO-SYNC] سینک خودکار با موفقیت کامل شد.');

    return {
      success: true,
      message: `سینک خودکار موفق: ${productsResult.data?.created || 0} محصول جدید، ${productsResult.data?.updated || 0} محصول به‌روز شده، ${ordersResult.data?.created || 0} سفارش جدید`,
      data: {
        productsResult,
        ordersResult,
      },
    };
  } catch (error: unknown) {
    const errorObj = error as { message?: string };
    console.error('[AUTO-SYNC] خطا در سینک خودکار:', error);
    return {
      success: false,
      message: `خطا در سینک خودکار: ${errorObj.message || 'خطای نامشخص'}`,
    };
  }
}

/**
 * تصحیح وضعیت پرداخت سفارشات قدیمی براساس وضعیت آنها در WooCommerce
 * این تابع سفارشاتی که از WooCommerce آمده‌اند را بررسی می‌کند و
 * paymentStatus آنها را براساس وضعیت فعلی در WooCommerce به‌روز می‌کند
 */
export async function fixOldPendingOrders(): Promise<ActionResult<{
  fixed: number;
  checked: number;
  errors: number;
}>> {
  try {
    console.log('[FIX-PENDING] شروع تصحیح سفارشات pending قدیمی...');

    // Get WooCommerce client
    let wooCommerce;
    try {
      wooCommerce = await getWooCommerceClient();
      console.log('[FIX-PENDING] اتصال به WooCommerce برقرار شد');
    } catch (error: any) {
      console.error('[FIX-PENDING] خطا در اتصال به WooCommerce:', error);
      return {
        success: false,
        message: `خطا در اتصال به WooCommerce: ${error.message || 'لطفا تنظیمات WooCommerce را بررسی کنید.'}`,
        data: {
          fixed: 0,
          checked: 0,
          errors: 0,
        },
      };
    }

    // Get all orders that came from WooCommerce
    const ordersFromWoo = await prisma.order.findMany({
      where: {
        wooId: { not: null },
      },
      include: {
        transaction: true,
      },
    });

    console.log(`[FIX-PENDING] ${ordersFromWoo.length} سفارش از WooCommerce یافت شد`);

    if (ordersFromWoo.length === 0) {
      return {
        success: true,
        message: 'هیچ سفارشی از WooCommerce یافت نشد.',
        data: {
          fixed: 0,
          checked: 0,
          errors: 0,
        },
      };
    }

    let fixedCount = 0;
    let checkedCount = 0;
    let errorCount = 0;

    for (const order of ordersFromWoo) {
      try {
        checkedCount++;

        // Get current status from WooCommerce
        const wooOrder = await wooCommerce.get(`orders/${order.wooId}`);
        const currentStatus = wooOrder.data.status;

        console.log(`[FIX-PENDING] بررسی سفارش #${order.number} (WooCommerce status: ${currentStatus})`);

        // Determine correct payment status based on WooCommerce status
        const shouldBePaid = currentStatus === 'completed';
        const correctPaymentStatus = shouldBePaid ? 'PAID' : 'UNPAID';
        const correctPaidAmount = shouldBePaid ? order.totalAmount : 0;
        const correctStatus = shouldBePaid ? 'COMPLETED' : 'PENDING';

        // Check if needs fixing
        if (order.paymentStatus !== correctPaymentStatus ||
            order.paidAmount.toString() !== correctPaidAmount.toString() ||
            order.status !== correctStatus) {
          console.log(`[FIX-PENDING] تصحیح سفارش #${order.number}: ${order.paymentStatus} -> ${correctPaymentStatus}`);

          await prisma.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: correctPaymentStatus,
              paidAmount: new Prisma.Decimal(correctPaidAmount),
              status: correctStatus,
            },
          });

          fixedCount++;
        }
      } catch (error: any) {
        errorCount++;
        console.error(`[FIX-PENDING] خطا در بررسی سفارش #${order.number}:`, error.message);
        // Continue with next order
      }
    }

    console.log(`[FIX-PENDING] تصحیح کامل شد: ${fixedCount} سفارش تصحیح شد از ${checkedCount} سفارش بررسی شده`);

    if (errorCount > 0) {
      return {
        success: true,
        message: `${fixedCount} سفارش تصحیح شد از ${checkedCount} سفارش. ${errorCount} خطا در بررسی.`,
        data: {
          fixed: fixedCount,
          checked: checkedCount,
          errors: errorCount,
        },
      };
    }

    return {
      success: true,
      message: `${fixedCount} سفارش تصحیح شد از ${checkedCount} سفارش بررسی شده`,
      data: {
        fixed: fixedCount,
        checked: checkedCount,
        errors: 0,
      },
    };
  } catch (error: unknown) {
    const errorObj = error as { message?: string };
    console.error('[FIX-PENDING] خطای غیرمنتظره:', error);
    return {
      success: false,
      message: `خطای غیرمنتظره: ${errorObj.message || 'خطای نامشخص'}`,
      data: {
        fixed: 0,
        checked: 0,
        errors: 0,
      },
    };
  }
}

/**
 * Force sync: دریافت مجدد تمام سفارشات از WooCommerce و به‌روزرسانی وضعیت پرداخت
 * این تابع ساده‌تر و مطمئن‌تر است و همه status ها را پشتیبانی می‌کند
 * بهینه‌سازی شده با batch fetching برای جلوگیری از timeout
 */
export async function forceSyncOrderStatus(): Promise<ActionResult<{
  synced: number;
  details: {
    pending: number;
    completed: number;
    cancelled: number;
    refunded: number;
    failed: number;
    other: number;
  };
}>> {
  try {
    console.log('[FORCE-SYNC] شروع force sync وضعیت سفارشات...');

    // Get WooCommerce client
    const wooCommerce = await getWooCommerceClient();
    console.log('[FORCE-SYNC] اتصال به WooCommerce برقرار شد');

    // Get all orders from our database that have wooId
    const ordersInDb = await prisma.order.findMany({
      where: {
        wooId: { not: null },
      },
    });

    console.log(`[FORCE-SYNC] ${ordersInDb.length} سفارش از WooCommerce در دیتابیس یافت شد`);

    // Fetch ALL orders from WooCommerce in batches (much faster than individual requests)
    console.log('[FORCE-SYNC] در حال دریافت تمام سفارشات از WooCommerce...');
    const allWooOrders: any[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await wooCommerce.get('orders', {
        per_page: perPage,
        page: page,
      });

      const orders = response.data;
      if (orders && orders.length > 0) {
        allWooOrders.push(...orders);
        console.log(`[FORCE-SYNC] صفحه ${page}: ${orders.length} سفارش دریافت شد`);

        // Check if there are more pages
        if (orders.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`[FORCE-SYNC] مجموع ${allWooOrders.length} سفارش از WooCommerce دریافت شد`);

    // Create a map for fast lookup
    const wooOrdersMap = new Map<number, any>();
    for (const wooOrder of allWooOrders) {
      wooOrdersMap.set(wooOrder.id, wooOrder);
    }

    let syncedCount = 0;
    const statusCounts = {
      pending: 0,
      completed: 0,
      cancelled: 0,
      refunded: 0,
      failed: 0,
      other: 0,
    };

    // Now update database orders based on WooCommerce status
    for (const order of ordersInDb) {
      try {
        const wooOrder = wooOrdersMap.get(order.wooId!);

        if (!wooOrder) {
          console.log(`[FORCE-SYNC] سفارش #${order.number} (wooId: ${order.wooId}) در WooCommerce یافت نشد - احتمالا حذف شده`);
          continue;
        }

        const currentStatus = wooOrder.status;
        console.log(`[FORCE-SYNC] سفارش #${order.number} - WooCommerce status: ${currentStatus}`);

        // Determine correct status and payment status based on WooCommerce status
        let newPaymentStatus = order.paymentStatus;
        let newOrderStatus = order.status;
        let newPaidAmount = order.paidAmount;

        switch (currentStatus) {
          case 'completed':
            newPaymentStatus = 'PAID';
            newOrderStatus = 'COMPLETED';
            newPaidAmount = order.totalAmount;
            statusCounts.completed++;
            break;

          case 'pending':
          case 'on-hold':
            newPaymentStatus = 'UNPAID';
            newOrderStatus = 'PENDING';
            newPaidAmount = 0;
            statusCounts.pending++;
            break;

          case 'cancelled':
          case 'failed':
            newPaymentStatus = 'UNPAID';
            newOrderStatus = 'CANCELLED';
            newPaidAmount = 0;
            if (currentStatus === 'cancelled') {
              statusCounts.cancelled++;
            } else {
              statusCounts.failed++;
            }
            break;

          case 'refunded':
            newPaymentStatus = 'UNPAID';
            newOrderStatus = 'CANCELLED';
            newPaidAmount = 0;
            statusCounts.refunded++;
            break;

          default:
            console.log(`[FORCE-SYNC] وضعیت ناشناخته: ${currentStatus} برای سفارش #${order.number}`);
            statusCounts.other++;
            continue;
        }

        // Update if needed
        if (
          order.paymentStatus !== newPaymentStatus ||
          order.status !== newOrderStatus ||
          order.paidAmount.toString() !== newPaidAmount.toString()
        ) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: newPaymentStatus,
              status: newOrderStatus,
              paidAmount: new Prisma.Decimal(newPaidAmount),
            },
          });

          console.log(
            `[FORCE-SYNC] سفارش #${order.number} به‌روز شد: ${order.paymentStatus} → ${newPaymentStatus}, ${order.status} → ${newOrderStatus}`
          );
          syncedCount++;
        }
      } catch (error: any) {
        console.error(`[FORCE-SYNC] خطا در بررسی سفارش #${order.number}:`, error.message);
        // Continue with next order
      }
    }

    console.log(`[FORCE-SYNC] کامل شد: ${syncedCount} سفارش به‌روز شد`);

    return {
      success: true,
      message: `${syncedCount} سفارش به‌روزرسانی شد (${statusCounts.pending} pending، ${statusCounts.completed} completed، ${statusCounts.cancelled} cancelled، ${statusCounts.refunded} refunded، ${statusCounts.failed} failed)`,
      data: {
        synced: syncedCount,
        details: statusCounts,
      },
    };
  } catch (error: unknown) {
    const errorObj = error as { message?: string };
    console.error('[FORCE-SYNC] خطا:', error);
    return {
      success: false,
      message: `خطا در force sync: ${errorObj.message || 'لطفا تنظیمات WooCommerce را بررسی کنید'}`,
      data: {
        synced: 0,
        details: {
          pending: 0,
          completed: 0,
          cancelled: 0,
          refunded: 0,
          failed: 0,
          other: 0,
        },
      },
    };
  }
}

