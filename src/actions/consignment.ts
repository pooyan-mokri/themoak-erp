'use server';

import { PrismaClient, Prisma } from '@prisma/client';
import { TransactionType, Currency, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

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
 */
export async function recordConsignmentSales(input: {
  partnerWarehouseId: string;
  saleDate: string; // ISO date or YYYY-MM-DD
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
}): Promise<ActionResult> {
  const validated = BatchSettlementSchema.safeParse(input);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as any,
      message: 'لطفا فیلدها را به درستی پر کنید.',
    };
  }

  const { partnerWarehouseId, saleDate, items } = validated.data;
  // Normalise to start-of-day to make per-date matching deterministic
  const day = new Date(saleDate);
  day.setHours(0, 0, 0, 0);
  const dayStart = new Date(day);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  try {
    await prisma.$transaction(async (tx: any) => {
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
          createdAt: { gte: dayStart, lte: dayEnd },
          items: { some: { warehouseId: partnerWarehouseId } },
        },
        include: { items: true },
      });

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
        // Recalculate gross from ALL items
        const allItems = await tx.orderItem.findMany({
          where: { orderId: order.id },
        });
        const newGross = allItems.reduce(
          (sum: number, it: any) => sum + it.quantity * Number(it.price),
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
            date: day,
          },
        });
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در ثبت فروش امانی.';
    return { message };
  }

  revalidatePath('/dashboard/consignment/settlement');
  revalidatePath('/dashboard/consignment/reports');
  revalidatePath('/dashboard/consignment/commissions');
  revalidatePath('/dashboard/sales');
  revalidatePath('/dashboard/inventory');
  return { message: 'فروش‌های امانی با موفقیت ثبت شد.', success: true };
}

export async function getConsignmentPartners() {
    try {
        const partners = await prisma.warehouse.findMany({
            where: { isVirtual: true, customerId: { not: null } },
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
  try {
    const orders = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        status: { not: 'CANCELLED' },
        customer: {
          warehouses: { some: { isVirtual: true } },
        },
      },
      include: {
        customer: true,
        items: { include: { product: true } },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order: any) => {
      const paidAmount = order.paidAmount ? Number(order.paidAmount) : 0;
      const commission = order.commissions?.[0];
      const commissionAmount = commission ? Number(commission.commissionAmount) : 0;
      const commissionRate = commission ? Number(commission.commissionRate) : 0;
      // Gross is always the sum of item prices (reliable for old & new orders).
      const grossAmount = order.items.reduce(
        (sum: number, it: any) => sum + it.quantity * Number(it.price),
        0,
      );
      // Our share = gross − partner commission. Derive it instead of trusting
      // order.totalAmount, which is gross for legacy single-item orders.
      const netShare = grossAmount - commissionAmount;
      return {
        ...order,
        totalAmount: netShare,
        paidAmount,
        remainingAmount: netShare - paidAmount,
        grossAmount,
        commissionAmount,
        commissionRate,
        discount: order.discount ? Number(order.discount) : undefined,
        items: order.items.map((item: any) => ({
          ...item,
          price: Number(item.price),
        })),
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
 * If no amount is provided, the full remaining balance is paid.
 */
export async function paySettlement(prevState: ActionState, formData: FormData): Promise<ActionResult> {
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

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get Order with items + commission so we can derive the net payable
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, commissions: true },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }
      if (order.paymentStatus === 'PAID') {
        throw new Error('این سفارش قبلاً به طور کامل پرداخت شده است.');
      }

      // Net payable = gross (sum of items) − partner commission. Derived so it
      // is correct for both legacy (gross-stored) and new (net-stored) orders.
      const grossAmount = order.items.reduce(
        (sum: number, it: any) => sum + it.quantity * Number(it.price),
        0,
      );
      const commissionAmount = order.commissions?.[0]
        ? Number(order.commissions[0].commissionAmount)
        : 0;
      const netPayable = grossAmount - commissionAmount;
      const currentPaid = Number(order.paidAmount || 0);
      const remaining = netPayable - currentPaid;
      const payAmount = amount ?? remaining;

      if (payAmount <= 0) {
        throw new Error('مبلغ پرداخت باید بزرگتر از صفر باشد.');
      }
      if (payAmount > remaining + 0.01) {
        throw new Error(`مبلغ پرداخت (${payAmount.toLocaleString('fa-IR')}) از مبلغ باقیمانده (${remaining.toLocaleString('fa-IR')}) بیشتر است.`);
      }

      // 2. Create INCOME transaction for this payment
      const transaction = await tx.transaction.create({
        data: {
          currency: Currency.TOMAN,
          type: TransactionType.INCOME,
          accountId,
          amount: new Prisma.Decimal(payAmount),
          amountInToman: new Prisma.Decimal(payAmount),
          rateSnapshot: 1,
          date: paymentDate ? new Date(paymentDate) : new Date(),
          description: `تسویه فروش امانی - سفارش #${order.number}${
            payAmount < remaining ? ' (پرداخت جزئی)' : ''
          }`,
          customerId: order.customerId ?? undefined,
        },
      });

      // 3. Update account balance
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: payAmount } },
      });

      // 4. Update order paid status against the NET payable
      const newPaid = currentPaid + payAmount;
      const fullyPaid = newPaid >= netPayable - 0.01;

      await tx.order.update({
        where: { id: orderId },
        data: {
          // Normalise legacy orders: store the net as totalAmount going forward
          totalAmount: new Prisma.Decimal(netPayable),
          paidAmount: new Prisma.Decimal(newPaid),
          paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
          // Always standard COMPLETED (also normalises legacy PENDING_PAYMENT)
          status: 'COMPLETED',
          // Only set transactionId for full payment (preserves last-payment ref)
          transactionId: fullyPaid ? transaction.id : order.transactionId,
        },
      });
    });
  } catch (error: unknown) {
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
 *  - settlement payment (INCOME) transactions are deleted and their account
 *    balance decremented
 *  - non-cash COGS / commission EXPENSE transactions are deleted
 *  - commission rows, SALE movements, items and the order itself are removed
 * Removing the order also removes it from sales history (same table).
 */
export async function deleteConsignmentOrder(
  orderId: string,
): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          commissions: true,
          customer: { include: { warehouses: { where: { isVirtual: true } } } },
        },
      });
      if (!order) throw new Error('سفارش یافت نشد.');
      if (!order.customer?.warehouses?.length) {
        throw new Error('این سفارش یک فاکتور امانی نیست.');
      }

      const alreadyCancelled = order.status === 'CANCELLED';

      // 1. Return sold goods to the partner warehouse (skip if a prior
      //    cancellation already restored them).
      if (!alreadyCancelled) {
        for (const item of order.items) {
          if (!item.warehouseId) continue;
          await tx.inventory.upsert({
            where: {
              productId_warehouseId: {
                productId: item.productId,
                warehouseId: item.warehouseId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              productId: item.productId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
            },
          });
          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              toWarehouseId: item.warehouseId,
              quantity: item.quantity,
              type: 'RETURN',
              note: 'حذف فاکتور امانی',
            },
          });
        }
      }

      // 2. Reverse all related transactions. Match by description containing
      //    the exact order number (guard against #19 vs #197 with a regex).
      const candidates = await tx.transaction.findMany({
        where: {
          customerId: order.customerId ?? undefined,
          description: { contains: `سفارش #${order.number}` },
        },
      });
      const numRe = new RegExp(`#${order.number}(?!\\d)`);
      for (const trx of candidates) {
        if (!trx.description || !numRe.test(trx.description)) continue;
        // Settlement income moved real cash → reverse the account balance.
        if (trx.type === TransactionType.INCOME && trx.accountId) {
          await tx.account.update({
            where: { id: trx.accountId },
            data: { balance: { decrement: Number(trx.amount) } },
          });
        }
        await tx.transaction.delete({ where: { id: trx.id } });
      }

      // 3. Remove SALE movements created for this order.
      await tx.inventoryMovement.deleteMany({ where: { referenceId: orderId } });

      // 4. Remove commissions, items, and the order itself.
      await tx.consignmentCommission.deleteMany({ where: { orderId } });
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'خطا در حذف فاکتور امانی.';
    return { message };
  }

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
        include: { items: true, commissions: true },
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
    const currentStockValue = warehouse.inventory.reduce(
      (s: number, inv: any) => s + inv.quantity * Number(inv.product.costPrice || 0),
      0,
    );

    let grossSales = 0;
    let commissionTotal = 0;
    let receivedTotal = 0;
    for (const order of orders) {
      const gross = order.items.reduce(
        (s: number, it: any) => s + it.quantity * Number(it.price),
        0,
      );
      grossSales += gross;
      commissionTotal += order.commissions?.[0]
        ? Number(order.commissions[0].commissionAmount)
        : 0;
      receivedTotal += Number(order.paidAmount || 0);
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
        const gross = o.items.reduce(
          (s: number, it: any) => s + it.quantity * Number(it.price),
          0,
        );
        const commission = o.commissions?.[0]
          ? Number(o.commissions[0].commissionAmount)
          : 0;
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
