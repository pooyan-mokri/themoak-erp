'use server';

import { PrismaClient, Prisma } from '@prisma/client';
import { TransactionType, Currency, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { restoreOrderItemStock } from '@/lib/restore-warehouse';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, getCurrentRole, hasPermission, requirePermission } from '@/lib/access';
import { balanceEffect, inAccountCurrency } from '@/lib/balance-reconciliation';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { consignmentAmounts, effectiveQuantity } from '@/lib/return-math';

// const prisma = new PrismaClient();

// Ensure a non-cash EXPENSE account exists (balance kept at 0 so it never
// pollutes the balance-sheet cash total; only feeds P&L which sums by type).
async function ensureExpenseAccount(tx: any, name: string): Promise<string> {
  const existing = await tx.account.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { name, type: 'EXPENSE', currency: 'TOMAN', balance: 0 },
  });
  return created.id;
}

// --- Schemas ---

const PartnerSchema = z.object({
  name: z.string().min(1, 'نام همکار الزامی است'),
  phone: z.string().optional(),
  address: z.string().optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
});

const TransferSchema = z.object({
  sourceWarehouseId: z.string().min(1, 'انبار مبدا الزامی است'),
  targetWarehouseId: z.string().min(1, 'انبار مقصد الزامی است'),
  productId: z.string().min(1, 'محصول الزامی است'),
  quantity: z.coerce.number().min(1, 'تعداد باید بیشتر از صفر باشد'),
});

const BatchSettlementItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().min(1),
  unitPrice: z.coerce.number().min(0),
});

const BatchSettlementSchema = z.object({
  partnerWarehouseId: z.string().min(1, 'انبار همکار الزامی است'),
  saleDate: z.string().min(1, 'تاریخ فروش الزامی است'),
  items: z.array(BatchSettlementItemSchema).min(1, 'حداقل یک آیتم باید وارد شود'),
});

// --- Actions ---

export async function createConsignmentPartner(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validatedFields = PartnerSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone') || undefined,
    address: formData.get('address') || undefined,
    commissionRate: formData.get('commissionRate') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, phone, address, commissionRate } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Create Customer
      const customer = await tx.customer.create({
        data: {
          name,
          phone,
          address,
          commissionRate: commissionRate ? new Prisma.Decimal(commissionRate) : undefined,
        },
      });

      // 2. Create Virtual Warehouse
      await tx.warehouse.create({
        data: {
          name: `انبار امانی - ${name}`,
          isVirtual: true,
          customerId: customer.id,
        },
      });
    });
  } catch (error) {
    return { message: 'خطا در ایجاد همکار امانی.' };
  }

  revalidatePath('/dashboard', 'layout');
  return { message: 'همکار امانی با موفقیت ایجاد شد.' };
}

export async function updateConsignmentPartner(partnerId: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validatedFields = PartnerSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone') || undefined,
    address: formData.get('address') || undefined,
    commissionRate: formData.get('commissionRate') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, phone, address, commissionRate } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // Find warehouse and customer
      const warehouse = await tx.warehouse.findUnique({
        where: { id: partnerId },
        include: { customer: true },
      });

      if (!warehouse || !warehouse.customerId) {
        throw new Error('همکار یافت نشد.');
      }

      // Update Customer
      await tx.customer.update({
        where: { id: warehouse.customerId },
        data: {
          name,
          phone,
          address,
          commissionRate: commissionRate ? new Prisma.Decimal(commissionRate) : undefined,
        },
      });

      // Update Warehouse name if needed
      await tx.warehouse.update({
        where: { id: partnerId },
        data: {
          name: `انبار امانی - ${name}`,
        },
      });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در بروزرسانی همکار امانی.';
    return { message };
  }

  revalidatePath('/dashboard', 'layout');
  return { message: 'همکار امانی با موفقیت بروزرسانی شد.', success: true };
}

export async function transferStock(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validatedFields = TransferSchema.safeParse({
    sourceWarehouseId: formData.get('sourceWarehouseId'),
    targetWarehouseId: formData.get('targetWarehouseId'),
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { sourceWarehouseId, targetWarehouseId, productId, quantity } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // Check source stock
      const sourceStock = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: sourceWarehouseId,
          },
        },
      });

      if (!sourceStock || sourceStock.quantity < quantity) {
        throw new Error('موجودی انبار مبدا کافی نیست.');
      }

      // Decrement source
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: sourceWarehouseId,
          },
        },
        data: {
          quantity: { decrement: quantity },
        },
      });

      // Increment target
      await tx.inventory.upsert({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: targetWarehouseId,
          },
        },
        update: {
          quantity: { increment: quantity },
        },
        create: {
          productId,
          warehouseId: targetWarehouseId,
          quantity,
        },
      });

      // Record the movement so it shows up in the warehouse movements tab
      await tx.inventoryMovement.create({
        data: {
          productId,
          fromWarehouseId: sourceWarehouseId,
          toWarehouseId: targetWarehouseId,
          quantity,
          type: 'TRANSFER',
          note: 'انتقال امانی به همکار',
        },
      });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در انتقال موجودی.';
    return { message };
  }

  kickSiteHook();
  revalidatePath('/dashboard/consignment/transfer');
  revalidatePath('/dashboard/inventory');
  return { message: 'انتقال موجودی با موفقیت انجام شد.' };
}

/**
 * Send several products to a consignment partner warehouse in one atomic batch.
 */
export async function transferStockBatch(input: {
  sourceWarehouseId: string;
  targetWarehouseId: string;
  items: Array<{ productId: string; quantity: number }>;
}): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const { sourceWarehouseId, targetWarehouseId, items } = input;

  if (!sourceWarehouseId || !targetWarehouseId) {
    return { success: false, message: 'انبار مبدا و مقصد را انتخاب کنید.' };
  }
  if (sourceWarehouseId === targetWarehouseId) {
    return { success: false, message: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند.' };
  }
  const validItems = items.filter((i) => i.productId && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, message: 'حداقل یک کالا به لیست اضافه کنید.' };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      for (const item of validItems) {
        const sourceStock = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: sourceWarehouseId } },
        });

        if (!sourceStock || sourceStock.quantity < item.quantity) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new Error(`موجودی انبار مبدا برای «${product?.name ?? item.productId}» کافی نیست.`);
        }

        await tx.inventory.update({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: sourceWarehouseId } },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: targetWarehouseId } },
          update: { quantity: { increment: item.quantity } },
          create: { productId: item.productId, warehouseId: targetWarehouseId, quantity: item.quantity },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            fromWarehouseId: sourceWarehouseId,
            toWarehouseId: targetWarehouseId,
            quantity: item.quantity,
            type: 'TRANSFER',
            note: 'انتقال امانی به همکار',
          },
        });
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در انتقال موجودی.';
    return { success: false, message };
  }

  kickSiteHook();
  revalidatePath('/dashboard/consignment/transfer');
  revalidatePath('/dashboard/inventory');
  return { success: true, message: `انتقال ${validItems.length} کالا با موفقیت انجام شد.` };
}

/**
 * Record a batch of consignment sales reported by a partner for a specific date.
 * Groups ALL items into ONE Order. If an unpaid order already exists for this
 * (partner, date), items are appended to it instead of creating a new one.
 *
 * Commission model: the partner already deducts their commission BEFORE paying
 * us, so:
 *   - Order.totalAmount = NET amount we are owed (gross − commission)
 *   - ConsignmentCommission records the gross & commission split for reporting
 *   - Commission is marked isPaid=true at creation (partner auto-deducted it)
 *
 * Each call books its own COGS and commission expense rows, so the same
 * report must not be booked twice: a submission sent again (a retry after an
 * error, a double click) carries the same requestId and is answered without
 * writing, and lines that are all already on the day's order are refused
 * until the user confirms them (confirmRepeat) as a genuinely new report.
 */
export async function recordConsignmentSales(input: {
  partnerWarehouseId: string;
  saleDate: string; // ISO date or YYYY-MM-DD
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  requestId?: string;
  confirmRepeat?: boolean;
}): Promise<ActionResult<{ repeatOf: number }>> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validated = BatchSettlementSchema.safeParse(input);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as any,
      message: 'لطفا فیلدها را به درستی پر کنید.',
    };
  }

  const { partnerWarehouseId, saleDate, items } = validated.data;
  const requestId = readRequestId(input.requestId);
  // Normalise to start-of-day to make per-date matching deterministic
  const day = new Date(saleDate);
  day.setHours(0, 0, 0, 0);
  const dayStart = new Date(day);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  try {
    const outcome: { duplicate?: boolean; repeatOf?: number } = await prisma.$transaction(async (tx: any) => {
      // One recording at a time per partner, so a repeat sees the first one's lines.
      await tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${partnerWarehouseId} FOR UPDATE`;
      if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
        return { duplicate: true };
      }

      // 1. Verify partner and warehouse
      const warehouse = await tx.warehouse.findUnique({
        where: { id: partnerWarehouseId },
        include: { customer: true },
      });
      if (!warehouse || !warehouse.customerId || !warehouse.customer) {
        throw new Error('انبار همکار یا مشتری مرتبط یافت نشد.');
      }

      // 2. Check inventory for each item BEFORE doing anything, and total COGS
      let cogsTotal = 0;
      for (const item of items) {
        const stock = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: partnerWarehouseId,
            },
          },
          include: { product: { select: { name: true, costPrice: true } } },
        });
        if (!stock || stock.quantity < item.quantity) {
          throw new Error(
            `موجودی کافی نیست برای محصول ${stock?.product?.name ?? item.productId} (موجودی: ${stock?.quantity ?? 0}, درخواست: ${item.quantity})`,
          );
        }
        cogsTotal += item.quantity * Number(stock.product.costPrice || 0);
      }

      // 3. Calculate totals
      const commissionRate = warehouse.customer.commissionRate
        ? Number(warehouse.customer.commissionRate)
        : 0;
      const grossTotal = items.reduce(
        (sum, i) => sum + i.quantity * i.unitPrice,
        0,
      );
      const commissionAmount = (grossTotal * commissionRate) / 100;
      const netAmount = grossTotal - commissionAmount;
      // Commission newly incurred in THIS call (for the expense entry)
      let commissionExpenseAmount = 0;

      // 4. Find existing not-fully-paid order for this (partner, date).
      // Keyed off paymentStatus so it works for legacy PENDING_PAYMENT orders
      // and new COMPLETED+UNPAID ones alike.
      let order = await tx.order.findFirst({
        where: {
          customerId: warehouse.customerId,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          // Cancelling an order leaves paymentStatus UNPAID, so without this a
          // new sale is appended to a CANCELLED order: the stock is deducted
          // but the sale is invisible everywhere (settlement lists filter
          // cancelled orders out).
          status: { not: 'CANCELLED' },
          createdAt: { gte: dayStart, lte: dayEnd },
          items: { some: { warehouseId: partnerWarehouseId } },
        },
        include: { items: true },
      });

      // The same lines booked again onto the same day's order: most likely the
      // same report entered twice. Only an explicit confirmation books them.
      if (
        order &&
        !input.confirmRepeat &&
        items.every((item) =>
          order.items.some(
            (line: any) =>
              line.productId === item.productId &&
              line.quantity === item.quantity &&
              Number(line.price) === item.unitPrice,
          ),
        )
      ) {
        return { repeatOf: order.number as number };
      }

      if (order) {
        // Append items to existing order
        for (const item of items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              quantity: item.quantity,
              price: new Prisma.Decimal(item.unitPrice),
              warehouseId: partnerWarehouseId,
              status: 'PENDING',
            },
          });
        }
        // Recalculate gross from ALL items, counting only units still sold
        // (returned and exchanged units are no longer owed or commissioned)
        const allItems = await tx.orderItem.findMany({
          where: { orderId: order.id },
          include: { returns: true, exchanges: true },
        });
        const newGross = allItems.reduce(
          (sum: number, it: any) => sum + effectiveQuantity(it) * Number(it.price),
          0,
        );
        const newCommission = (newGross * commissionRate) / 100;
        const newNet = newGross - newCommission;

        await tx.order.update({
          where: { id: order.id },
          data: { totalAmount: new Prisma.Decimal(newNet) },
        });

        // Update or create the single commission record for the order
        const existingCommission = await tx.consignmentCommission.findFirst({
          where: { orderId: order.id },
        });
        if (existingCommission) {
          // Only the incremental commission is a new expense
          commissionExpenseAmount =
            newCommission - Number(existingCommission.commissionAmount || 0);
          await tx.consignmentCommission.update({
            where: { id: existingCommission.id },
            data: {
              orderAmount: new Prisma.Decimal(newGross),
              commissionAmount: new Prisma.Decimal(newCommission),
              commissionRate: new Prisma.Decimal(commissionRate),
            },
          });
        } else if (commissionRate > 0) {
          commissionExpenseAmount = newCommission;
          await tx.consignmentCommission.create({
            data: {
              customerId: warehouse.customerId,
              orderId: order.id,
              commissionRate: new Prisma.Decimal(commissionRate),
              orderAmount: new Prisma.Decimal(newGross),
              commissionAmount: new Prisma.Decimal(newCommission),
              isPaid: true, // partner already deducted it
              paidDate: new Date(),
            },
          });
        }
      } else {
        // Create new order with all items
        order = await tx.order.create({
          data: {
            customerId: warehouse.customerId,
            totalAmount: new Prisma.Decimal(netAmount),
            // Standard status (sale happened); settlement tracked via paymentStatus
            status: 'COMPLETED',
            paymentStatus: 'UNPAID',
            paidAmount: new Prisma.Decimal(0),
            createdAt: day,
            items: {
              create: items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                price: new Prisma.Decimal(i.unitPrice),
                warehouseId: partnerWarehouseId,
                status: 'PENDING',
              })),
            },
          },
        });

        if (commissionRate > 0) {
          commissionExpenseAmount = commissionAmount;
          await tx.consignmentCommission.create({
            data: {
              customerId: warehouse.customerId,
              orderId: order.id,
              commissionRate: new Prisma.Decimal(commissionRate),
              orderAmount: new Prisma.Decimal(grossTotal),
              commissionAmount: new Prisma.Decimal(commissionAmount),
              isPaid: true, // partner already deducted it
              paidDate: new Date(),
            },
          });
        }
      }

      // 5. Decrement partner inventory and record movements
      for (const item of items) {
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: partnerWarehouseId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            fromWarehouseId: partnerWarehouseId,
            quantity: item.quantity,
            type: 'SALE',
            referenceId: order.id,
            note: 'فروش امانی',
          },
        });
      }

      // 6. Record P&L expenses (non-cash): COGS + partner commission.
      // Booked against dedicated EXPENSE accounts whose balance stays 0, so
      // they reduce net profit (P&L sums by type) without touching cash.
      // The first row written carries the submission's requestId.
      let firstRow = true;
      const requestIdOnce = () => {
        const id = firstRow ? requestId ?? undefined : undefined;
        firstRow = false;
        return id;
      };
      if (cogsTotal > 0) {
        const cogsAccountId = await ensureExpenseAccount(
          tx,
          'بهای تمام‌شده کالای فروش‌رفته',
        );
        await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            currency: Currency.TOMAN,
            amount: new Prisma.Decimal(cogsTotal),
            amountInToman: new Prisma.Decimal(cogsTotal),
            rateSnapshot: 1,
            accountId: cogsAccountId,
            category: 'COGS',
            description: `بهای تمام‌شده کالای فروش امانی - سفارش #${order.number}`,
            customerId: warehouse.customerId,
            orderId: order.id,
            clientRequestId: requestIdOnce(),
            date: day,
          },
        });
      }
      if (commissionExpenseAmount > 0) {
        const commAccountId = await ensureExpenseAccount(
          tx,
          'کمیسیون همکاران امانی',
        );
        await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            currency: Currency.TOMAN,
            amount: new Prisma.Decimal(commissionExpenseAmount),
            amountInToman: new Prisma.Decimal(commissionExpenseAmount),
            rateSnapshot: 1,
            accountId: commAccountId,
            category: 'CONSIGNMENT_COMMISSION',
            description: `کمیسیون همکار امانی - سفارش #${order.number}`,
            customerId: warehouse.customerId,
            orderId: order.id,
            clientRequestId: requestIdOnce(),
            date: day,
          },
        });
      }
      return {};
    });
    if (outcome.duplicate) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    if (outcome.repeatOf) {
      return {
        message: `همین اقلام با همین تعداد و قیمت قبلاً در فاکتور #${outcome.repeatOf} برای این تاریخ ثبت شده‌اند. اگر فروش تازه‌ای است، دوباره تأیید کنید.`,
        data: { repeatOf: outcome.repeatOf },
      };
    }
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    const message = error instanceof Error ? error.message : 'خطا در ثبت فروش امانی.';
    return { message };
  }

  kickSiteHook();
  revalidatePath('/dashboard/consignment/settlement');
  revalidatePath('/dashboard/consignment/reports');
  revalidatePath('/dashboard/consignment/commissions');
  revalidatePath('/dashboard/sales');
  revalidatePath('/dashboard/inventory');
  return { message: 'فروش‌های امانی با موفقیت ثبت شد.', success: true };
}

export async function getConsignmentPartners() {
    await requirePermission('sales.view');
    try {
        const partners = await prisma.warehouse.findMany({
            where: { isVirtual: true, customerId: { not: null }, isArchived: false },
            include: { customer: true }
        });
        return partners.map((partner: any) => ({
            ...partner,
            customer: partner.customer ? {
                ...partner.customer,
                commissionRate: partner.customer.commissionRate ? Number(partner.customer.commissionRate) : undefined,
                phone: partner.customer.phone ?? undefined,
                email: partner.customer.email ?? undefined,
                address: partner.customer.address ?? undefined,
                notes: partner.customer.notes ?? undefined,
                wooId: partner.customer.wooId ?? undefined,
                taxId: partner.customer.taxId ?? undefined,
                segment: partner.customer.segment ?? undefined,
            } : undefined,
        }));
    } catch (error) {
        return [];
    }
}

export async function getConsignmentPartnerById(warehouseId: string) {
    await requirePermission('sales.view');
    try {
        const warehouse = await prisma.warehouse.findUnique({
            where: { id: warehouseId },
            include: { customer: true }
        });
        if (!warehouse || !warehouse.customer) return undefined;
        return {
            ...warehouse,
            customer: {
                ...warehouse.customer,
                commissionRate: warehouse.customer.commissionRate ? Number(warehouse.customer.commissionRate) : undefined,
                phone: warehouse.customer.phone ?? undefined,
                email: warehouse.customer.email ?? undefined,
                address: warehouse.customer.address ?? undefined,
                notes: warehouse.customer.notes ?? undefined,
                wooId: warehouse.customer.wooId ?? undefined,
                taxId: warehouse.customer.taxId ?? undefined,
                segment: warehouse.customer.segment ?? undefined,
            },
        };
    } catch (error) {
        return undefined;
    }
}

export async function getPendingSettlements() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const orders = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        status: { not: 'CANCELLED' },
        customer: {
          warehouses: { some: { isVirtual: true } },
        },
        // Website orders are paid and reversed only on the website.
        siteReference: null,
      },
      include: {
        customer: true,
        items: { include: { product: true, returns: true, exchanges: true } },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order: any) => {
      // Gross is the sum of item prices over the units still sold (reliable
      // for old & new orders, and for lines partly returned or exchanged).
      // Our share = gross − partner commission. Derive it instead of trusting
      // order.totalAmount, which is gross for legacy single-item orders.
      const { grossAmount, commissionAmount, commissionRate, netAmount, paidAmount, remainingAmount } =
        consignmentAmounts(order);
      return {
        ...order,
        totalAmount: netAmount,
        paidAmount,
        remainingAmount,
        grossAmount,
        commissionAmount,
        commissionRate,
        discount: order.discount ? Number(order.discount) : undefined,
        items: order.items.map((item: any) => {
          const { costPrice, ...product } = item.product;
          const { returns, exchanges, ...line } = item;
          return {
            ...line,
            soldQuantity: effectiveQuantity(item),
            price: Number(item.price),
            product: canSeeCost ? item.product : product,
          };
        }),
      };
    });
  } catch (error) {
    console.error('Error fetching pending settlements:', error);
    return [];
  }
}

const PaymentSchema = z.object({
  orderId: z.string().min(1),
  accountId: z.string().min(1, 'حساب مقصد الزامی است'),
  amount: z.coerce.number().positive('مبلغ باید بزرگتر از صفر باشد').optional(),
  paymentDate: z.string().optional(),
});

/**
 * Record a payment from a consignment partner against an order.
 * Supports PARTIAL payments — if amount < remaining, order stays
 * PENDING_PAYMENT with paymentStatus = PARTIAL.
 *
 * If no amount is provided, the full remaining balance is paid. The amount is
 * in Toman and lands on a bank or cash account in that account's currency.
 * The payment row carries the order and the form's requestId, so a
 * submission sent twice is booked once.
 */
export async function paySettlement(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validatedFields = PaymentSchema.safeParse({
    orderId: formData.get('orderId'),
    accountId: formData.get('accountId'),
    amount: formData.get('amount') || undefined,
    paymentDate: formData.get('paymentDate') || undefined,
  });

  if (!validatedFields.success) {
    return { message: 'اطلاعات پرداخت نامعتبر است.' };
  }

  const { orderId, accountId, amount, paymentDate } = validatedFields.data;
  const requestId = readRequestId(formData.get('requestId'));

  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      // Payments on one order run one after the other; the second re-checks
      // the remaining amount the first one left.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
        return 'duplicate';
      }

      // 1. Get Order with items + commission so we can derive the net payable
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { returns: true, exchanges: true } }, commissions: true },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }
      if (order.siteReference) {
        throw new Error(WEBSITE_ORDER_LOCKED);
      }
      if (order.status === 'CANCELLED') {
        throw new Error('این سفارش لغو شده است و نمی‌توان برای آن پرداخت ثبت کرد.');
      }
      if (order.paymentStatus === 'PAID') {
        throw new Error('این سفارش قبلاً به طور کامل پرداخت شده است.');
      }

      // Net payable = gross (units still sold) − partner commission. Derived
      // so it is correct for both legacy (gross-stored) and new (net-stored)
      // orders, and after returns and exchanges.
      const { netAmount: netPayable, paidAmount: currentPaid, remainingAmount: remaining } = consignmentAmounts(order);
      const payAmount = amount ?? remaining;

      if (payAmount <= 0) {
        throw new Error('مبلغ پرداخت باید بزرگتر از صفر باشد.');
      }
      if (payAmount > remaining + 0.01) {
        throw new Error(`مبلغ پرداخت (${payAmount.toLocaleString('fa-IR')}) از مبلغ باقیمانده (${remaining.toLocaleString('fa-IR')}) بیشتر است.`);
      }

      // 2. The money lands on a real bank or cash account, in its currency.
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) {
        throw new Error('حساب مقصد یافت نشد.');
      }
      if (account.type !== 'BANK' && account.type !== 'CASH') {
        throw new Error('حساب مقصد باید از نوع بانک یا صندوق باشد.');
      }
      const converted = await inAccountCurrency(tx, account, payAmount);

      // 3. Create INCOME transaction for this payment
      const transaction = await tx.transaction.create({
        data: {
          currency: account.currency,
          type: TransactionType.INCOME,
          accountId,
          amount: new Prisma.Decimal(converted.amount),
          amountInToman: new Prisma.Decimal(payAmount),
          rateSnapshot: new Prisma.Decimal(converted.rate),
          date: paymentDate ? new Date(paymentDate) : new Date(),
          description: `تسویه فروش امانی - سفارش #${order.number}${
            payAmount < remaining ? ' (پرداخت جزئی)' : ''
          }`,
          customerId: order.customerId ?? undefined,
          orderId,
          clientRequestId: requestId ?? undefined,
        },
      });

      // 4. Update account balance
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: new Prisma.Decimal(converted.amount) } },
      });

      // 5. Update order paid status against the NET payable. The sale amount
      //    (totalAmount) is the sale's, kept by the sale, returns and exchanges.
      const newPaid = currentPaid + payAmount;
      const fullyPaid = newPaid >= netPayable - 0.01;

      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: new Prisma.Decimal(newPaid),
          paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
          // Always standard COMPLETED (also normalises legacy PENDING_PAYMENT)
          status: 'COMPLETED',
          // Only set transactionId for full payment (preserves last-payment ref)
          transactionId: fullyPaid ? transaction.id : order.transactionId,
        },
      });
      return 'done';
    });
    if (outcome === 'duplicate') return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
  } catch (error: unknown) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    const message = error instanceof Error ? error.message : 'خطا در ثبت پرداخت.';
    return { message };
  }

  revalidatePath('/dashboard/consignment/settlement');
  revalidatePath('/dashboard/consignment/reports');
  revalidatePath('/dashboard/consignment/commissions');
  revalidatePath('/dashboard/accounting');
  return { message: 'پرداخت با موفقیت ثبت شد.', success: true };
}

/**
 * Fully delete a consignment settlement order and reverse everything it
 * caused:
 *  - sold goods go back to the partner's virtual warehouse (unless the order
 *    was already CANCELLED via sales history, which already restored stock)
 *  - every money row of the order is deleted and what it did to its
 *    account's balance is undone: rows linked by orderId (checkout,
 *    «ثبت پرداخت», settlement payments, return refunds, exchange
 *    differences), the checkout row (Order.transactionId), and older rows
 *    that only name «سفارش #N» in their description
 *  - non-cash COGS / commission EXPENSE transactions are deleted (they sit on
 *    EXPENSE accounts whose balance they never moved)
 *  - returns, exchanges, commission rows, SALE movements, items and the order
 *    itself are removed
 * Removing the order also removes it from sales history (same table).
 * Deleting money that reached a bank or cash account is for an admin only.
 */
export async function deleteConsignmentOrder(
  orderId: string,
): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const isAdmin = (await getCurrentRole()) === 'ADMIN';
  try {
    await prisma.$transaction(async (tx: any) => {
      // A payment, return or exchange on this order either committed before
      // this point or waits here and then finds the order gone, so none of its
      // money is left behind unlinked.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          commissions: true,
          customer: { include: { warehouses: { where: { isVirtual: true } } } },
        },
      });
      if (!order) throw new Error('سفارش یافت نشد.');
      if (order.siteReference) throw new Error(WEBSITE_ORDER_LOCKED);
      if (!order.customer?.warehouses?.length) {
        throw new Error('این سفارش یک فاکتور امانی نیست.');
      }

      const alreadyCancelled = order.status === 'CANCELLED';

      // 1. Return sold goods to the partner warehouse (skip if a prior
      //    cancellation already restored them).
      if (!alreadyCancelled) {
        // Same never-skip contract as cancelOrder: lines whose warehouse was
        // never recorded (or was blanked when a warehouse was deleted) are
        // resolved through the shared fallback instead of being dropped.
        for (const item of order.items) {
          await restoreOrderItemStock(
            tx,
            order as any,
            item as any,
            (item as any).product?.name ?? item.productId,
            order.number,
          );
        }
      }

      // 2. Reverse all related transactions: every row linked to the order,
      //    its checkout row, and older rows written before rows were linked,
      //    matched by the exact order number in the wording the app itself
      //    writes for an order's money (guard against #19 vs #197). A row typed
      //    by hand that names the order (a courier cost «... سفارش #N») moved
      //    money for its own reason and stays.
      const candidates = await tx.transaction.findMany({
        where: {
          OR: [
            { orderId },
            ...(order.transactionId ? [{ id: order.transactionId }] : []),
            { description: { contains: `سفارش #${order.number}` } },
          ],
        },
        include: { account: true },
      });
      const appWording = new RegExp(
        `^(دریافت بابت|تسویه فروش امانی -|تسویه حساب امانی -|بهای تمام\u200cشده کالای فروش امانی -|کمیسیون همکار امانی -|عودت کالا -|تعویض کالا -|پرداخت فاکتور .+ -) سفارش #${order.number}(?!\\d)`,
      );
      const moneyRows = candidates.filter(
        (trx: any) =>
          trx.orderId === orderId ||
          trx.id === order.transactionId ||
          (trx.orderId == null &&
            (trx.type === TransactionType.INCOME || trx.type === TransactionType.EXPENSE) &&
            (trx.customerId == null || trx.customerId === order.customerId) &&
            appWording.test(trx.description ?? '')),
      );
      // The COGS and commission rows sit on EXPENSE accounts kept at 0 and never
      // moved a balance. Every other row did, whatever its account: the old
      // settlement modal let a payment land on an EXPENSE account and raised it.
      const movedCash = (trx: any) =>
        !!trx.account &&
        !(trx.account.type === 'EXPENSE' && (trx.category === 'COGS' || trx.category === 'CONSIGNMENT_COMMISSION'));
      if (!isAdmin && moneyRows.some(movedCash)) {
        throw new Error('دسترسی غیرمجاز — این فاکتور پرداخت یا بازپرداخت ثبت‌شده دارد و فقط مدیر سیستم می‌تواند آن را حذف کند.');
      }
      for (const trx of moneyRows) {
        // Undo exactly what the row did to its account, in the account's currency.
        if (movedCash(trx)) {
          await tx.account.update({
            where: { id: trx.accountId },
            data: { balance: { increment: -balanceEffect(trx) } },
          });
        }
        await tx.transaction.delete({ where: { id: trx.id } });
      }

      // 3. Remove SALE movements created for this order.
      await tx.inventoryMovement.deleteMany({ where: { referenceId: orderId } });

      // 4. Remove commissions, returns, exchanges, items, and the order itself.
      await tx.consignmentCommission.deleteMany({ where: { orderId } });
      await tx.orderExchange.deleteMany({ where: { orderId } });
      await tx.orderReturn.deleteMany({ where: { orderId } });
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'خطا در حذف فاکتور امانی.';
    return { message };
  }

  kickSiteHook();
  revalidatePath('/dashboard/consignment/settlement');
  revalidatePath('/dashboard/consignment/reports');
  revalidatePath('/dashboard/consignment/commissions');
  revalidatePath('/dashboard/consignment/statement');
  revalidatePath('/dashboard/sales/history');
  revalidatePath('/dashboard/accounting');
  revalidatePath('/dashboard/inventory');
  return { message: 'فاکتور امانی با موفقیت حذف شد.', success: true };
}

const ReturnSchema = z.object({
  partnerWarehouseId: z.string().min(1, 'انبار همکار الزامی است'),
  targetWarehouseId: z.string().min(1, 'انبار مقصد الزامی است'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1, 'حداقل یک قلم کالا باید انتخاب شود'),
});

/**
 * Return UNSOLD consignment goods from a partner's virtual warehouse back to a
 * real warehouse. Pure inventory move, no financial impact (the goods were
 * never sold, so no revenue/commission is involved).
 */
export async function returnConsignmentStock(input: {
  partnerWarehouseId: string;
  targetWarehouseId: string;
  items: Array<{ productId: string; quantity: number }>;
}): Promise<ActionResult> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const validated = ReturnSchema.safeParse(input);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as any,
      message: 'لطفا فیلدها را به درستی پر کنید.',
    };
  }

  const { partnerWarehouseId, targetWarehouseId, items } = validated.data;

  if (partnerWarehouseId === targetWarehouseId) {
    return { message: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند.' };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      const partner = await tx.warehouse.findUnique({
        where: { id: partnerWarehouseId },
      });
      if (!partner || !partner.isVirtual) {
        throw new Error('انبار مبدا یک انبار امانی معتبر نیست.');
      }

      for (const item of items) {
        const stock = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: partnerWarehouseId,
            },
          },
          include: { product: { select: { name: true } } },
        });
        if (!stock || stock.quantity < item.quantity) {
          throw new Error(
            `موجودی کافی نیست برای ${stock?.product?.name ?? item.productId} (موجودی: ${stock?.quantity ?? 0}، درخواست: ${item.quantity})`,
          );
        }

        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: partnerWarehouseId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventory.upsert({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: targetWarehouseId,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            productId: item.productId,
            warehouseId: targetWarehouseId,
            quantity: item.quantity,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            fromWarehouseId: partnerWarehouseId,
            toWarehouseId: targetWarehouseId,
            quantity: item.quantity,
            type: 'RETURN',
            note: 'برگشت کالای فروش‌نرفته امانی',
          },
        });
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در ثبت برگشت کالا.';
    return { message };
  }

  kickSiteHook();
  revalidatePath('/dashboard/consignment/return');
  revalidatePath('/dashboard/consignment/reports');
  revalidatePath('/dashboard/inventory');
  return { message: 'برگشت کالای امانی با موفقیت ثبت شد.', success: true };
}

/**
 * Full account statement for a single consignment partner: goods sent /
 * returned / sold, current stock at partner, and the financial split
 * (gross sales, partner commission, our net share, received, balance).
 */
export async function getPartnerStatement(partnerWarehouseId: string) {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: partnerWarehouseId },
      include: {
        customer: true,
        inventory: { include: { product: true } },
      },
    });
    if (!warehouse || !warehouse.customerId || !warehouse.customer) {
      return undefined;
    }

    const [movements, orders] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where: {
          OR: [
            { toWarehouseId: partnerWarehouseId },
            { fromWarehouseId: partnerWarehouseId },
          ],
        },
        include: { product: { select: { name: true, sku: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.order.findMany({
        where: {
          customerId: warehouse.customerId,
          status: { not: 'CANCELLED' },
          items: { some: { warehouseId: partnerWarehouseId } },
        },
        include: { items: { include: { returns: true, exchanges: true } }, commissions: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Sold = sum of item quantities across non-cancelled orders (reliable,
    // unlike SALE movements which only exist for sales recorded after the
    // movement table was introduced).
    const soldQty = orders.reduce(
      (s: number, o: any) =>
        s +
        o.items
          .filter((it: any) => it.warehouseId === partnerWarehouseId)
          .reduce((q: number, it: any) => q + it.quantity, 0),
      0,
    );
    const returnedQty = movements
      .filter((m: any) => m.fromWarehouseId === partnerWarehouseId && m.type === 'RETURN')
      .reduce((s: number, m: any) => s + m.quantity, 0);

    const currentStockQty = warehouse.inventory.reduce(
      (s: number, inv: any) => s + inv.quantity,
      0,
    );
    // Conservation identity: everything ever sent to the partner is either
    // still in stock, sold, or returned. Robust even when historical TRANSFER
    // movements were never recorded.
    const sentQty = currentStockQty + soldQty + returnedQty;
    // Stock at cost: null without cost.view.
    const currentStockValue = canSeeCost
      ? warehouse.inventory.reduce(
          (s: number, inv: any) => s + inv.quantity * Number(inv.product.costPrice || 0),
          0,
        )
      : null;

    // Money is counted over the units still sold (returned and exchanged
    // units are neither owed nor commissioned), as in the settlement list.
    let grossSales = 0;
    let commissionTotal = 0;
    let receivedTotal = 0;
    for (const order of orders) {
      const amounts = consignmentAmounts(order);
      grossSales += amounts.grossAmount;
      commissionTotal += amounts.commissionAmount;
      receivedTotal += amounts.paidAmount;
    }
    const ourShare = grossSales - commissionTotal;
    const balance = ourShare - receivedTotal;

    return {
      partner: {
        warehouseId: warehouse.id,
        name: warehouse.customer.name,
        phone: warehouse.customer.phone ?? undefined,
        commissionRate: warehouse.customer.commissionRate
          ? Number(warehouse.customer.commissionRate)
          : 0,
      },
      logistics: { sentQty, returnedQty, soldQty, currentStockQty, currentStockValue },
      financials: {
        grossSales,
        commissionTotal,
        ourShare,
        receivedTotal,
        balance,
      },
      currentStock: warehouse.inventory
        .filter((inv: any) => inv.quantity !== 0)
        .map((inv: any) => ({
          productName: inv.product.name,
          sku: inv.product.sku,
          quantity: inv.quantity,
        })),
      orders: orders.map((o: any) => {
        const { grossAmount: gross, commissionAmount: commission } = consignmentAmounts(o);
        return {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          itemCount: o.items.length,
          gross,
          commission,
          net: gross - commission,
          paid: Number(o.paidAmount || 0),
          paymentStatus: o.paymentStatus,
        };
      }),
    };
  } catch (error) {
    console.error('Error building partner statement:', error);
    return undefined;
  }
}
