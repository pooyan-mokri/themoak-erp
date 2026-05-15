'use server';

import { PrismaClient, Prisma } from '@prisma/client';
import { TransactionType, Currency, ActionResult, ActionState } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

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

const SettlementSchema = z.object({
  partnerWarehouseId: z.string().min(1, 'انبار همکار الزامی است'),
  productId: z.string().min(1, 'محصول الزامی است'),
  quantity: z.coerce.number().min(1, 'تعداد فروخته شده الزامی است'),
  unitPrice: z.coerce.number().min(0, 'قیمت واحد الزامی است'),
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
      
      // Record Transfer Transaction (Optional: usually no financial impact yet, but good to log)
      // For now, we just move stock.
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'خطا در انتقال موجودی.';
    return { message };
  }

  revalidatePath('/dashboard/consignment/transfer');
  revalidatePath('/dashboard/inventory');
  return { message: 'انتقال موجودی با موفقیت انجام شد.' };
}

export async function settleSales(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = SettlementSchema.safeParse({
    partnerWarehouseId: formData.get('partnerWarehouseId'),
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
    unitPrice: formData.get('unitPrice'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { partnerWarehouseId, productId, quantity, unitPrice } = validatedFields.data;
  const totalAmount = quantity * unitPrice;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Deduct from Partner Warehouse
      const stock = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: partnerWarehouseId,
          },
        },
      });

      if (!stock || stock.quantity < quantity) {
        throw new Error('موجودی انبار همکار کافی نیست.');
      }

      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: partnerWarehouseId,
          },
        },
        data: {
          quantity: { decrement: quantity },
        },
      });

      // 2. Find Partner Customer
      const warehouse = await tx.warehouse.findUnique({
        where: { id: partnerWarehouseId },
        include: { customer: true },
      });

      if (!warehouse || !warehouse.customerId) {
        throw new Error('این انبار متعلق به هیچ همکاری نیست.');
      }

      // 3. Create Financial Transaction (Receivable)
      // We need an account to track this. For now, let's assume we have a "Accounts Receivable" logic.
      // Or we just record it as INCOME but unpaid?
      // Let's record it as a Transaction linked to the Customer (via Order or direct).
      // Since we don't have "Accounts Receivable" account type explicitly yet, 
      // let's create a Transaction of type INCOME, but maybe we need a "Pending Settlement" status?
      // For simplicity in this MVP: We will create an Order for this customer.
      
      // 3. Create Order
      const order = await tx.order.create({
        data: {
          customerId: warehouse.customerId,
          totalAmount: new Prisma.Decimal(totalAmount),
          status: 'PENDING_PAYMENT',
          paymentStatus: 'UNPAID',
          items: {
            create: [{
              productId,
              quantity,
              price: new Prisma.Decimal(unitPrice),
              warehouseId: partnerWarehouseId,
            }]
          }
        }
      });

      // 4. Calculate and record commission if customer has commission rate
      if (warehouse.customer && warehouse.customer.commissionRate) {
        const commissionRate = Number(warehouse.customer.commissionRate);
        const commissionAmount = (totalAmount * commissionRate) / 100;

        if (commissionAmount > 0) {
          await tx.consignmentCommission.create({
            data: {
              customerId: warehouse.customerId,
              orderId: order.id,
              commissionRate: new Prisma.Decimal(commissionRate),
              orderAmount: new Prisma.Decimal(totalAmount),
              commissionAmount: new Prisma.Decimal(commissionAmount),
              isPaid: false,
            },
          });
        }
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
  return { message: 'فروش امانی ثبت شد و فاکتور صادر گردید.' };
}

/**
 * ONE-TIME MIGRATION: Consolidate existing per-item consignment orders into
 * one order per (partner, date). For each consignment customer, finds all
 * PENDING_PAYMENT or PARTIAL orders on the same calendar day, merges their
 * items into the earliest one, updates the consolidated commission,
 * and deletes the now-empty old orders.
 *
 * Idempotent: groups with only 1 order are skipped.
 * Safe to re-run: already-consolidated days will be no-ops.
 */
export async function consolidateConsignmentOrders(): Promise<
  ActionResult<{ merged: number; deletedOrders: number }>
> {
  try {
    let mergedGroups = 0;
    let deletedOrders = 0;

    // Find all consignment customers (those with a virtual warehouse)
    const partners = await prisma.customer.findMany({
      where: { warehouses: { some: { isVirtual: true } } },
      include: {
        warehouses: { where: { isVirtual: true } },
      },
    });

    for (const partner of partners) {
      const virtualWarehouseId = partner.warehouses[0]?.id;
      if (!virtualWarehouseId) continue;

      // All non-cancelled consignment orders for this partner
      const orders = await prisma.order.findMany({
        where: {
          customerId: partner.id,
          status: { in: ['PENDING_PAYMENT', 'COMPLETED'] },
          items: { some: { warehouseId: virtualWarehouseId } },
        },
        include: {
          items: true,
          commissions: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      // Group by calendar day
      const groups = new Map<string, typeof orders>();
      for (const order of orders) {
        const day = new Date(order.createdAt);
        day.setHours(0, 0, 0, 0);
        const key = `${day.toISOString().slice(0, 10)}-${order.paymentStatus}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(order);
      }

      const commissionRate = partner.commissionRate ? Number(partner.commissionRate) : 0;

      for (const [, group] of groups) {
        if (group.length <= 1) continue; // nothing to merge
        // Skip if mixing already-paid with unpaid in same day — too risky to merge automatically
        const allUnpaid = group.every(
          (o) => o.paymentStatus !== 'PAID' && o.status !== 'COMPLETED',
        );
        if (!allUnpaid) continue;

        await prisma.$transaction(async (tx: any) => {
          const master = group[0]; // earliest
          const rest = group.slice(1);

          // Move all items from rest into master
          for (const o of rest) {
            await tx.orderItem.updateMany({
              where: { orderId: o.id },
              data: { orderId: master.id },
            });
          }

          // Recalculate totals from ALL items now under master
          const allItems = await tx.orderItem.findMany({
            where: { orderId: master.id },
          });
          const newGross = allItems.reduce(
            (sum: number, i: any) => sum + i.quantity * Number(i.price),
            0,
          );
          const newCommission = (newGross * commissionRate) / 100;
          const newNet = newGross - newCommission;

          // Sum existing paidAmount from all merged orders (in case any had partial payments)
          const totalPaid = group.reduce(
            (sum, o) => sum + Number(o.paidAmount || 0),
            0,
          );
          const fullyPaid = totalPaid >= newNet - 0.01;

          await tx.order.update({
            where: { id: master.id },
            data: {
              totalAmount: new Prisma.Decimal(newNet),
              paidAmount: new Prisma.Decimal(totalPaid),
              paymentStatus: fullyPaid ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
              status: fullyPaid ? 'COMPLETED' : 'PENDING_PAYMENT',
            },
          });

          // Consolidate commissions: delete others, update master's
          const masterCommission = master.commissions?.[0];
          for (const o of rest) {
            await tx.consignmentCommission.deleteMany({ where: { orderId: o.id } });
          }
          if (masterCommission) {
            await tx.consignmentCommission.update({
              where: { id: masterCommission.id },
              data: {
                orderAmount: new Prisma.Decimal(newGross),
                commissionAmount: new Prisma.Decimal(newCommission),
                commissionRate: new Prisma.Decimal(commissionRate),
                isPaid: true,
              },
            });
          } else if (commissionRate > 0) {
            await tx.consignmentCommission.create({
              data: {
                customerId: partner.id,
                orderId: master.id,
                commissionRate: new Prisma.Decimal(commissionRate),
                orderAmount: new Prisma.Decimal(newGross),
                commissionAmount: new Prisma.Decimal(newCommission),
                isPaid: true,
                paidDate: new Date(),
              },
            });
          }

          // Delete the now-empty rest orders
          for (const o of rest) {
            await tx.order.delete({ where: { id: o.id } });
            deletedOrders++;
          }
          mergedGroups++;
        });
      }
    }

    revalidatePath('/dashboard/consignment/settlement');
    revalidatePath('/dashboard/consignment/reports');
    revalidatePath('/dashboard/sales/history');
    return {
      success: true,
      message: `ادغام انجام شد: ${mergedGroups} گروه ادغام شد و ${deletedOrders} سفارش اضافه حذف شد.`,
      data: { merged: mergedGroups, deletedOrders },
    };
  } catch (error: unknown) {
    console.error('Error consolidating consignment orders:', error);
    const message = error instanceof Error ? error.message : 'خطا در ادغام سفارش‌ها.';
    return { success: false, message };
  }
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

      // 2. Check inventory for each item BEFORE doing anything
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
            `موجودی کافی نیست برای محصول ${stock?.product?.name ?? item.productId} (موجودی: ${stock?.quantity ?? 0}, درخواست: ${item.quantity})`,
          );
        }
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

      // 4. Find existing unpaid order for this (partner, date), or create one
      let order = await tx.order.findFirst({
        where: {
          customerId: warehouse.customerId,
          status: { in: ['PENDING_PAYMENT'] },
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
          await tx.consignmentCommission.update({
            where: { id: existingCommission.id },
            data: {
              orderAmount: new Prisma.Decimal(newGross),
              commissionAmount: new Prisma.Decimal(newCommission),
              commissionRate: new Prisma.Decimal(commissionRate),
            },
          });
        } else if (commissionRate > 0) {
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
            status: 'PENDING_PAYMENT',
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
        status: { in: ['PENDING_PAYMENT'] },
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
      const totalAmount = Number(order.totalAmount);
      const paidAmount = order.paidAmount ? Number(order.paidAmount) : 0;
      const commission = order.commissions?.[0];
      const grossAmount = commission ? Number(commission.orderAmount) : totalAmount;
      const commissionAmount = commission ? Number(commission.commissionAmount) : 0;
      const commissionRate = commission ? Number(commission.commissionRate) : 0;
      return {
        ...order,
        totalAmount,
        paidAmount,
        remainingAmount: totalAmount - paidAmount,
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
      // 1. Get Order with current paid amount
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }
      if (order.status === 'COMPLETED' || order.paymentStatus === 'PAID') {
        throw new Error('این سفارش قبلاً به طور کامل پرداخت شده است.');
      }

      const totalAmount = Number(order.totalAmount);
      const currentPaid = Number(order.paidAmount || 0);
      const remaining = totalAmount - currentPaid;
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

      // 4. Update order paid status
      const newPaid = currentPaid + payAmount;
      const fullyPaid = newPaid >= totalAmount - 0.01;

      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: new Prisma.Decimal(newPaid),
          paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
          status: fullyPaid ? 'COMPLETED' : 'PENDING_PAYMENT',
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
