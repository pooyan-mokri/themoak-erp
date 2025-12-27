'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { ActionResult, ActionState } from '@/lib/types';

// Generate unique audit number
function generateAuditNumber(): string {
  const prefix = 'AUD';
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${year}-${random}`;
}

// Generate unique barcode for tags (if product doesn't have barcode, generate one)
function generateTagBarcode(auditId: string, index: number, productBarcode?: string | null): string {
  // Use product barcode if available, otherwise generate tag barcode
  if (productBarcode) {
    return productBarcode;
  }
  return `TAG-${auditId.substring(0, 8)}-${index.toString().padStart(6, '0')}`;
}

// 1. Pre-Audit: Create Inventory Audit
export async function createInventoryAudit(
  prevState: ActionState<{ auditId: string }>,
  formData: FormData
): Promise<ActionResult<{ auditId: string }>> {
  try {
    console.log('=== createInventoryAudit START ===');
    const session = await auth();
    console.log('Session:', session?.user?.id);
    
    if (!session?.user?.id) {
      console.log('No session found');
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const warehouseId = formData.get('warehouseId') as string;
    const description = formData.get('description') as string;
    
    console.log('FormData values:', { warehouseId, description });

    if (!warehouseId) {
      console.log('No warehouseId provided');
      return { success: false, message: 'لطفاً انبار را انتخاب کنید.' };
    }

    // Check if warehouse exists
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!warehouse) {
      return { success: false, message: 'انبار یافت نشد.' };
    }

    // Check if there's an active audit for this warehouse
    const activeAudit = await prisma.inventoryAudit.findFirst({
      where: {
        warehouseId,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
      },
    });

    if (activeAudit) {
      return {
        success: false,
        message: `یک انبارگردانی فعال برای این انبار وجود دارد: ${activeAudit.auditNumber}`,
      };
    }

    const auditNumber = generateAuditNumber();

    const audit = await prisma.inventoryAudit.create({
      data: {
        auditNumber,
        warehouseId,
        description: description || null,
        status: 'PLANNED',
        createdBy: session.user.id,
      },
    });

    revalidatePath('/dashboard/inventory/audits');
    console.log('=== createInventoryAudit SUCCESS ===', audit.id);
    return {
      success: true,
      message: 'انبارگردانی با موفقیت ایجاد شد.',
      data: { auditId: audit.id },
    };
  } catch (error: unknown) {
    console.error('=== createInventoryAudit ERROR ===', error);
    const message = error instanceof Error ? error.message : 'لطفاً دوباره تلاش کنید.';
    return {
      success: false,
      message: `خطا در ایجاد انبارگردانی: ${message}`,
    };
  }
}

// 2. Pre-Audit: Freeze Inventory (Create Snapshot)
export async function freezeInventory(auditId: string): Promise<ActionResult<{ snapshotCount: number }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: { warehouse: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (audit.isFrozen) {
      return { success: false, message: 'موجودی قبلاً فریز شده است.' };
    }

    // Get all inventory items for this warehouse
    const inventoryItems = await prisma.inventory.findMany({
      where: { warehouseId: audit.warehouseId },
      include: { product: true },
    });

    // Create snapshots
    const snapshots = inventoryItems.map((item) => ({
      auditId,
      productId: item.productId,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
      costPrice: item.product.costPrice,
    }));

    await prisma.$transaction(async (tx) => {
      // Create snapshots
      await tx.inventoryAuditSnapshot.createMany({
        data: snapshots,
      });

      // Create audit items for each product
      const auditItems = inventoryItems.map((item) => ({
        auditId,
        productId: item.productId,
        systemQuantity: item.quantity,
      }));

      await tx.inventoryAuditItem.createMany({
        data: auditItems,
      });

      // Update audit status
      await tx.inventoryAudit.update({
        where: { id: auditId },
        data: {
          isFrozen: true,
          frozenAt: new Date(),
          status: 'IN_PROGRESS',
          startDate: new Date(),
        },
      });
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'موجودی با موفقیت فریز شد.',
      data: { snapshotCount: snapshots.length },
    };
  } catch (error: unknown) {
    console.error('Error freezing inventory:', error);
    return {
      success: false,
      message: 'خطا در فریز کردن موجودی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 3. Pre-Audit: Generate Audit Tags
export async function generateAuditTags(
  auditId: string,
  tagType: string = 'SHELF',
  count?: number
): Promise<ActionResult<{ tagCount: number }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: { items: { include: { product: true } } },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    // If count is not provided, generate tags for all products
    const tagCount = count || audit.items.length;

    const tags = [];
    for (let i = 0; i < tagCount; i++) {
      const item = audit.items[i];
      const productBarcode = item?.product?.barcode;
      const barcode = generateTagBarcode(auditId, i + 1, productBarcode);
      tags.push({
        auditId,
        barcode,
        tagType,
        productId: item?.productId || null,
        createdAt: new Date(),
      });
    }

    await prisma.inventoryAuditTag.createMany({
      data: tags,
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: `${tags.length} تگ با موفقیت ایجاد شد.`,
      data: { tagCount: tags.length },
    };
  } catch (error: unknown) {
    console.error('Error generating audit tags:', error);
    return {
      success: false,
      message: 'خطا در ایجاد تگ‌ها. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 4. Pre-Audit: Add Team Member
export async function addAuditTeamMember(
  auditId: string,
  userId: string,
  role: string = 'COUNTER'
): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    // Check if user is already in team
    const existingMember = await prisma.inventoryAuditTeam.findUnique({
      where: {
        auditId_userId: {
          auditId,
          userId,
        },
      },
    });

    if (existingMember) {
      return { success: false, message: 'این کاربر قبلاً به تیم اضافه شده است.' };
    }

    await prisma.inventoryAuditTeam.create({
      data: {
        auditId,
        userId,
        role,
        canCount: role === 'COUNTER' || role === 'SUPERVISOR',
        canApprove: role === 'SUPERVISOR' || role === 'AUDITOR',
        assignedBy: session.user.id,
      },
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'عضو تیم با موفقیت اضافه شد.',
    };
  } catch (error: unknown) {
    console.error('Error adding team member:', error);
    return {
      success: false,
      message: 'خطا در اضافه کردن عضو تیم. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 5. Pre-Audit: Remove Team Member
export async function removeAuditTeamMember(auditId: string, userId: string): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    await prisma.inventoryAuditTeam.delete({
      where: {
        auditId_userId: {
          auditId,
          userId,
        },
      },
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'عضو تیم با موفقیت حذف شد.',
    };
  } catch (error: unknown) {
    console.error('Error removing team member:', error);
    return {
      success: false,
      message: 'خطا در حذف عضو تیم. لطفاً دوباره تلاش کنید.',
    };
  }
}

// Get Audit Details
export async function getInventoryAudit(auditId: string) {
  try {
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: {
        warehouse: true,
        items: {
          include: {
            product: true,
            countedBy1User: { select: { id: true, name: true, email: true } },
            countedBy2User: { select: { id: true, name: true, email: true } },
            countedBy3User: { select: { id: true, name: true, email: true } },
          },
          orderBy: { product: { name: 'asc' } },
        },
        tags: {
          include: { product: true },
          orderBy: { createdAt: 'desc' },
        },
        teams: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
            assignedByUser: { select: { id: true, name: true } },
          },
        },
        snapshots: {
          include: { product: true },
        },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (!audit) return undefined;

    return {
      ...audit,
      description: audit.description ?? undefined,
      items: audit.items.map(item => ({
        ...item,
        countedQuantity1: item.countedQuantity1 ?? undefined,
        countedQuantity2: item.countedQuantity2 ?? undefined,
        countedQuantity3: item.countedQuantity3 ?? undefined,
        countedBy1: item.countedBy1 ?? undefined,
        countedBy2: item.countedBy2 ?? undefined,
        countedBy3: item.countedBy3 ?? undefined,
        countedAt1: item.countedAt1 ?? undefined,
        countedAt2: item.countedAt2 ?? undefined,
        countedAt3: item.countedAt3 ?? undefined,
        finalQuantity: item.finalQuantity ?? undefined,
        discrepancy: item.discrepancy ?? undefined,
        discrepancyValue: item.discrepancyValue ? Number(item.discrepancyValue) : undefined,
        notes: item.notes ?? undefined,
        adjustmentDocId: item.adjustmentDocId ?? undefined,
        product: item.product ? {
          ...item.product,
          image: item.product.image ?? undefined,
          wooId: item.product.wooId ?? undefined,
          barcode: item.product.barcode ?? undefined,
        } : undefined,
      })),
      tags: audit.tags.map(tag => ({
        ...tag,
        location: tag.location ?? undefined,
        productId: tag.productId ?? undefined,
        printedAt: tag.printedAt ?? undefined,
        printedBy: tag.printedBy ?? undefined,
        product: tag.product ? {
          ...tag.product,
          image: tag.product.image ?? undefined,
          wooId: tag.product.wooId ?? undefined,
          barcode: tag.product.barcode ?? undefined,
        } : undefined,
      })),
      snapshots: audit.snapshots.map(snapshot => ({
        ...snapshot,
        product: snapshot.product ? {
          ...snapshot.product,
          image: snapshot.product.image ?? undefined,
          wooId: snapshot.product.wooId ?? undefined,
          barcode: snapshot.product.barcode ?? undefined,
        } : undefined,
      })),
    };
  } catch (error: unknown) {
    console.error('Error fetching inventory audit:', error);
    return undefined;
  }
}

// Get All Audits
export async function getInventoryAudits(warehouseId?: string) {
  try {
    const where: Prisma.InventoryAuditWhereInput = {};
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }

    const audits = await prisma.inventoryAudit.findMany({
      where,
      include: {
        warehouse: true,
        createdByUser: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            items: true,
            tags: true,
            teams: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return audits.map(audit => ({
      ...audit,
      description: audit.description ?? undefined,
      createdBy: audit.createdBy ?? undefined,
      startDate: audit.startDate ?? undefined,
      completedDate: audit.completedDate ?? undefined,
      frozenAt: audit.frozenAt ?? undefined,
    }));
  } catch (error: unknown) {
    console.error('Error fetching inventory audits:', error);
    return [];
  }
}

// ==================== EXECUTION TASKS ====================

// 6. Execution: Record Count (by barcode scan or manual)
export async function recordCount(
  auditId: string,
  productId: string,
  count: number,
  countRound: 1 | 2 | 3 = 1,
  notes?: string
): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    // Check if user is creator or in team
    const isCreator = audit.createdBy === session.user.id;
    
    if (!isCreator) {
      const teamMember = await prisma.inventoryAuditTeam.findUnique({
        where: {
          auditId_userId: {
            auditId,
            userId: session.user.id,
          },
        },
      });

      if (!teamMember || !teamMember.canCount) {
        return { success: false, message: 'شما مجوز شمارش ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
      }
    }

    // Update or create audit item
    const updateData: Record<string, number | string | Date> = {
      [`countedQuantity${countRound}`]: count,
      [`countedBy${countRound}`]: session.user.id,
      [`countedAt${countRound}`]: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    await prisma.inventoryAuditItem.upsert({
      where: {
        auditId_productId: {
          auditId,
          productId,
        },
      },
      update: updateData,
      create: {
        auditId,
        productId,
        systemQuantity: 0, // Will be set from snapshot
        ...updateData,
      },
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'شمارش با موفقیت ثبت شد.',
    };
  } catch (error: unknown) {
    console.error('Error recording count:', error);
    return {
      success: false,
      message: 'خطا در ثبت شمارش. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 7. Execution: Record Count by Barcode
export async function recordCountByBarcode(
  auditId: string,
  barcode: string,
  count: number,
  countRound: 1 | 2 | 3 = 1
): Promise<ActionResult> {
  try {
    // Find tag by barcode
    const tag = await prisma.inventoryAuditTag.findUnique({
      where: { barcode },
      include: { audit: true, product: true },
    });

    if (!tag) {
      return { success: false, message: 'تگ با این بارکد یافت نشد.' };
    }

    if (tag.auditId !== auditId) {
      return { success: false, message: 'این تگ متعلق به این انبارگردانی نیست.' };
    }

    if (!tag.productId) {
      return { success: false, message: 'این تگ به محصول خاصی مرتبط نیست.' };
    }

    return await recordCount(auditId, tag.productId, count, countRound);
  } catch (error: unknown) {
    console.error('Error recording count by barcode:', error);
    return {
      success: false,
      message: 'خطا در ثبت شمارش. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 8. Execution: Set Final Quantity (after multiple counts)
export async function setFinalQuantity(
  auditId: string,
  productId: string,
  finalQuantity: number
): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    // Check if user is creator or can approve
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { createdBy: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    const isCreator = audit.createdBy === session.user.id;
    
    if (!isCreator) {
      const teamMember = await prisma.inventoryAuditTeam.findUnique({
        where: {
          auditId_userId: {
            auditId,
            userId: session.user.id,
          },
        },
      });

      if (!teamMember || !teamMember.canApprove) {
        return { success: false, message: 'شما مجوز تأیید ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
      }
    }

    const auditItem = await prisma.inventoryAuditItem.findUnique({
      where: {
        auditId_productId: {
          auditId,
          productId,
        },
      },
      include: { product: true },
    });

    if (!auditItem) {
      return { success: false, message: 'آیتم انبارگردانی یافت نشد.' };
    }

    const discrepancy = finalQuantity - auditItem.systemQuantity;
    const discrepancyValue = discrepancy * Number(auditItem.product.costPrice);

    await prisma.inventoryAuditItem.update({
      where: {
        auditId_productId: {
          auditId,
          productId,
        },
      },
      data: {
        finalQuantity,
        discrepancy,
        discrepancyValue,
      },
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'مقدار نهایی با موفقیت ثبت شد.',
    };
  } catch (error: unknown) {
    console.error('Error setting final quantity:', error);
    return {
      success: false,
      message: 'خطا در ثبت مقدار نهایی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// ==================== POST-AUDIT TASKS ====================

// 9. Post-Audit: Calculate Discrepancies
export async function calculateDiscrepancies(auditId: string): Promise<ActionResult> {
  try {
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    // Calculate discrepancies for all items
    const updates = audit.items.map((item) => {
      if (item.finalQuantity === null) {
        return undefined;
      }

      const discrepancy = item.finalQuantity - item.systemQuantity;
      const discrepancyValue = discrepancy * Number(item.product.costPrice);

      return prisma.inventoryAuditItem.update({
        where: {
          auditId_productId: {
            auditId,
            productId: item.productId,
          },
        },
        data: {
          discrepancy,
          discrepancyValue,
        },
      });
    });

    await Promise.all(updates.filter((u) => u !== null));

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: 'مغایرت‌ها با موفقیت محاسبه شدند.',
    };
  } catch (error: unknown) {
    console.error('Error calculating discrepancies:', error);
    return {
      success: false,
      message: 'خطا در محاسبه مغایرت‌ها. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 10. Post-Audit: Get Discrepancy Report
export async function getDiscrepancyReport(auditId: string) {
  try {
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: {
        items: {
          where: {
            OR: [
              { discrepancy: { gt: 0 } },
              { discrepancy: { lt: 0 } },
            ],
          },
          include: {
            product: true,
          },
          orderBy: [
            { discrepancy: 'desc' },
            { product: { name: 'asc' } },
          ],
        },
        warehouse: true,
      },
    });

    if (!audit) {
      return undefined;
    }

    const totalDiscrepancyValue = audit.items.reduce(
      (sum, item) => sum + Number(item.discrepancyValue || 0),
      0
    );

    const shortageCount = audit.items.filter((item) => (item.discrepancy || 0) < 0).length;
    const excessCount = audit.items.filter((item) => (item.discrepancy || 0) > 0).length;

    return {
      audit,
      totalDiscrepancyValue,
      shortageCount,
      excessCount,
      totalItems: audit.items.length,
    };
  } catch (error: unknown) {
    console.error('Error fetching discrepancy report:', error);
    return undefined;
  }
}

// 11. Post-Audit: Issue Adjustment Documents
export async function issueAdjustmentDocuments(auditId: string): Promise<ActionResult<{ adjustedCount: number }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: {
        items: {
          where: {
            OR: [
              { discrepancy: { gt: 0 } },
              { discrepancy: { lt: 0 } },
            ],
            isAdjusted: false,
          },
          include: { product: true },
        },
        warehouse: true,
      },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی باید در حال انجام باشد.' };
    }

    // Import inventory actions
    const { adjustStock } = await import('./inventory');

    // Adjust inventory for each item
    const adjustments = audit.items.map(async (item) => {
      const adjustment = item.discrepancy || 0;

      if (adjustment !== 0) {
        // Adjust stock (positive for excess, negative for shortage)
        await adjustStock(item.productId, audit.warehouseId, adjustment);

        // Mark as adjusted
        await prisma.inventoryAuditItem.update({
          where: {
            auditId_productId: {
              auditId,
              productId: item.productId,
            },
          },
          data: {
            isAdjusted: true,
            adjustmentDocId: `ADJ-${auditId}-${item.productId}`,
          },
        });
      }
    });

    await Promise.all(adjustments);

    // Mark audit as completed
    await prisma.inventoryAudit.update({
      where: { id: auditId },
      data: {
        status: 'COMPLETED',
        completedDate: new Date(),
      },
    });

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: `اسناد اصلاحی برای ${audit.items.length} آیتم صادر شد.`,
      data: { adjustedCount: audit.items.length },
    };
  } catch (error: unknown) {
    console.error('Error issuing adjustment documents:', error);
    return {
      success: false,
      message: 'خطا در صدور اسناد اصلاحی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 12. Post-Audit: Get Performance Report
export async function getPerformanceReport(auditId: string) {
  try {
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      include: {
        items: {
          include: {
            product: true,
            countedBy1User: { select: { id: true, name: true } },
            countedBy2User: { select: { id: true, name: true } },
            countedBy3User: { select: { id: true, name: true } },
          },
        },
        teams: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        warehouse: true,
      },
    });

    if (!audit) {
      return undefined;
    }

    // Calculate statistics
    const totalItems = audit.items.length;
    const countedItems = audit.items.filter((item) => item.finalQuantity !== null).length;
    const itemsWithDiscrepancy = audit.items.filter(
      (item) => item.discrepancy !== null && item.discrepancy !== 0
    ).length;

    // Count by user
    const countByUser: Record<string, { name: string; count: number }> = {};
    audit.items.forEach((item) => {
      [item.countedBy1User, item.countedBy2User, item.countedBy3User].forEach((user) => {
        if (user) {
          if (!countByUser[user.id]) {
            countByUser[user.id] = { name: user.name, count: 0 };
          }
          countByUser[user.id].count++;
        }
      });
    });

    return {
      audit,
      statistics: {
        totalItems,
        countedItems,
        itemsWithDiscrepancy,
        accuracy: totalItems > 0 ? ((totalItems - itemsWithDiscrepancy) / totalItems) * 100 : 0,
      },
      countByUser: Object.values(countByUser),
    };
  } catch (error: unknown) {
    console.error('Error fetching performance report:', error);
    return undefined;
  }
}

