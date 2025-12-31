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
  const warehouse = await prisma.warehouse.findFirst({ where: { name: 'Main Warehouse' } });
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
        // Download and save product image if available
        let imageUrl = existingProduct.image;
        console.log(`[Sync] Product ${wooProduct.name} (ID: ${wooProductId}) - Checking for image...`);
        if (wooProduct.images && Array.isArray(wooProduct.images) && wooProduct.images.length > 0) {
          const imageData = wooProduct.images[0];
          const imageSrc = imageData?.src;
          console.log(`[Sync] Found image data:`, { 
            hasImages: !!wooProduct.images, 
            imagesLength: wooProduct.images.length,
            firstImageSrc: imageSrc 
          });
          
          if (imageSrc) {
            console.log(`[Sync] Downloading image from: ${imageSrc}`);
            const downloadedUrl = await downloadAndSaveProductImage(imageSrc);
            if (downloadedUrl) {
              console.log(`[Sync] Image downloaded successfully: ${downloadedUrl}`);
              imageUrl = downloadedUrl;
            } else {
              console.error(`[Sync] Failed to download image for product ${wooProduct.name}`);
            }
          }
        } else {
          console.log(`[Sync] No images found for product ${wooProduct.name}`);
        }

        // Update existing product
        await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            name: wooProduct.name || existingProduct.name,
            sellPrice: Number(wooProduct.price) || existingProduct.sellPrice,
            image: imageUrl,
            // Only update fields that should be synced
          },
        });
        updatedCount++;

        // Sync Inventory for existing product
        if (wooProduct.stock_quantity !== undefined && wooProduct.stock_quantity !== null) {
            const stockQuantity = Number(wooProduct.stock_quantity) || 0;
            await prisma.inventory.upsert({
                where: {
                    productId_warehouseId: {
                        productId: existingProduct.id,
                        warehouseId: warehouseId
                    }
                },
                update: {
                    quantity: stockQuantity
                },
                create: {
                    productId: existingProduct.id,
                    warehouseId: warehouseId,
                    quantity: stockQuantity
                }
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
             // Download and save product image if available
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
                 console.log(`[Sync] Downloading image from: ${imageSrc}`);
                 imageUrl = await downloadAndSaveProductImage(imageSrc);
                 if (imageUrl) {
                   console.log(`[Sync] Image downloaded successfully for new product: ${imageUrl}`);
                 } else {
                   console.error(`[Sync] Failed to download image for new product ${wooProduct.name}`);
                 }
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
                skippedCount++;
                existingOrdersCount++;
                console.log(`[PROCESS] ⊘ سفارش WooCommerce #${order.number} (ID: ${order.id}) قبلا ثبت شده است. (${existingOrdersCount} سفارش تکراری)`);
                continue;
            }
            
            console.log(`[PROCESS] پردازش سفارش جدید WooCommerce #${order.number} (ID: ${order.id})... (${processedCount}/${wooOrders.length})`);
            // 1. Find or Create Customer
            let customerId: string | undefined = undefined;
            if (order.billing?.email) {
                const existingCustomer = await prisma.customer.findFirst({
                    where: { 
                        OR: [
                            { email: order.billing.email },
                            { wooId: order.customer_id && order.customer_id !== 0 ? order.customer_id : undefined }
                        ]
                    }
                });

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
                    const newCustomer = await prisma.customer.create({
                        data: {
                            name: `${order.billing.first_name} ${order.billing.last_name}`.trim() || 'Guest',
                            email: order.billing.email,
                            phone: order.billing.phone,
                            address: [
                                order.billing.address_1,
                                order.billing.address_2,
                                order.billing.city,
                                order.billing.state,
                                order.billing.postcode
                            ].filter(Boolean).join(', '),
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
                        
                        // Create Transaction
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
                                wooStatus: order.status || 'pending',
                                date: new Date(order.date_created || Date.now())
                            }
                        });
                        console.log(`[DEBUG] تراکنش ایجاد شد: ${transaction.id}`);

                        // Create Order linked to Transaction
                        console.log(`[DEBUG] ایجاد سفارش برای سفارش WooCommerce #${order.number}...`);
                        const createdOrder = await tx.order.create({
                            data: {
                                wooId: order.id,
                                customerId: customerId,
                                totalAmount: new Prisma.Decimal(orderTotal),
                                discount: new Prisma.Decimal(orderDiscount),
                                paidAmount: new Prisma.Decimal(orderTotal),
                                paymentStatus: 'PAID', // WooCommerce orders are paid when completed
                                status: order.status === 'completed' ? 'COMPLETED' : 'PENDING',
                                transactionId: transaction.id,
                                createdAt: new Date(order.date_created || Date.now()),
                                items: {
                                    create: orderItemsData.map((item: any) => ({
                                        productId: item.productId,
                                        quantity: item.quantity,
                                        price: new Prisma.Decimal(item.price)
                                    }))
                                }
                            }
                        });
                        console.log(`[DEBUG] سفارش ایجاد شد: ${createdOrder.id}, number: ${createdOrder.number}`);
                        
                        // Update Account Balance
                        await tx.account.update({
                            where: { id: account.id },
                            data: {
                                balance: {
                                    increment: new Prisma.Decimal(orderTotal)
                                }
                            }
                        });

                        // 4. Deduct Inventory for each order item
                        const warehouseId = await getWooWarehouseId();
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
