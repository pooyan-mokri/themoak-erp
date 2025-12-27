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
    await prisma.$transaction(async (tx) => {
      // 1. Create Customer
      const customer = await tx.customer.create({
        data: {
          name,
          phone,
          address,
          commissionRate: commissionRate ? new Prisma.Decimal(commissionRate) : null,
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

  revalidatePath('/dashboard/consignment/partners');
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
    await prisma.$transaction(async (tx) => {
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
          commissionRate: commissionRate ? new Prisma.Decimal(commissionRate) : null,
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

  revalidatePath('/dashboard/consignment/partners');
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
    await prisma.$transaction(async (tx) => {
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
    await prisma.$transaction(async (tx) => {
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

export async function getConsignmentPartners() {
    try {
        const partners = await prisma.warehouse.findMany({
            where: { isVirtual: true, customerId: { not: null } },
            include: { customer: true }
        });
        return partners.map(partner => ({
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
        status: 'PENDING_PAYMENT',
        customer: {
          warehouses: {
            some: {
              isVirtual: true
            }
          }
        }
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    return orders.map(order => ({
      ...order,
      totalAmount: Number(order.totalAmount),
      discount: order.discount ? Number(order.discount) : undefined,
      paidAmount: order.paidAmount ? Number(order.paidAmount) : undefined,
      items: order.items.map(item => ({
        ...item,
        price: Number(item.price),
      })),
    }));
  } catch (error) {
    return [];
  }
}

const PaymentSchema = z.object({
  orderId: z.string().min(1),
  accountId: z.string().min(1, 'حساب مقصد الزامی است'),
});

export async function paySettlement(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = PaymentSchema.safeParse({
    orderId: formData.get('orderId'),
    accountId: formData.get('accountId'),
  });

  if (!validatedFields.success) {
    return { message: 'اطلاعات پرداخت نامعتبر است.' };
  }

  const { orderId, accountId } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Get Order
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order || order.status !== 'PENDING_PAYMENT') {
        throw new Error('سفارش یافت نشد یا قبلاً پرداخت شده است.');
      }

      // 2. Create Transaction (Income)
      const transaction = await tx.transaction.create({
        data: {
          // FIX: Transaction needs 'currency' (enum) and 'type' (enum).
          currency: Currency.TOMAN, // Defaulting to TOMAN for now as Order doesn't store it.
          type: TransactionType.INCOME,
          accountId: accountId,
          amountInToman: order.totalAmount, // Assuming 1:1 for TOMAN
          amount: order.totalAmount, // Added missing amount field
          rateSnapshot: 1,
          date: new Date(),
          description: `تسویه حساب امانی - سفارش #${order.number}`,
        }
      });

      // 3. Update Account Balance
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { increment: order.totalAmount }
        }
      });

      // 4. Update Order
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'COMPLETED',
          transactionId: transaction.id
        }
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
  return { message: 'پرداخت با موفقیت ثبت شد.' };
}
