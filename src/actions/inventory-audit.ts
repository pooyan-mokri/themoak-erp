'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { ActionResult, ActionState } from '@/lib/types';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, hasPermission, requirePermission } from '@/lib/access';

// Generate unique audit number
function generateAuditNumber(): string {
  const prefix = 'AUD';
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${year}-${random}`;
}

// Generate unique barcode for tags (if product doesn't have barcode, generate one)
function generateTagBarcode(auditId: string, index: number, productBarcode?: string): string {
  // Use product barcode if available, otherwise generate tag barcode
  if (productBarcode) {
    return productBarcode;
  }
  return `TAG-${auditId.substring(0, 8)}-${index.toString().padStart(6, '0')}`;
}

// Counts and quantity differences are stock.view; an item's discrepancy value and its product's cost price need
// cost.view, the sell price sales.view. Drops what the caller may not see from an audit item.
function withoutHiddenMoney(item: any, canSeeCost: boolean, canSeeSellPrice: boolean) {
  const { discrepancyValue, product, ...rest } = item;
  let shownProduct = product;
  if (product) {
    const { costPrice, sellPrice, ...productRest } = product;
    shownProduct = { ...productRest, ...(canSeeCost && { costPrice }), ...(canSeeSellPrice && { sellPrice }) };
  }
  return { ...rest, ...(canSeeCost && { discrepancyValue }), product: shownProduct };
}

// A refusal found inside a transaction: thrown so everything rolls back, then shown to the user as it is.
class AuditRefusal extends Error {}

// ADMIN, the audit's creator, or a team member with this permission.
async function mayWorkOnAudit(
  audit: { id: string; createdBy: string | null },
  user: { id: string; role: string },
  permission: 'canCount' | 'canApprove'
): Promise<boolean> {
  if (user.role === 'ADMIN' || audit.createdBy === user.id) return true;
  const member = await prisma.inventoryAuditTeam.findUnique({
    where: { auditId_userId: { auditId: audit.id, userId: user.id } },
  });
  return member?.[permission] === true;
}

// Runs `write` in a transaction that holds the audit row FOR SHARE, and only while the audit is IN_PROGRESS (false
// otherwise). Issuing claims that row with an UPDATE, so it waits for a write already running and then sees it, and a
// write started while issuing waits for the issue to commit and then finds the audit COMPLETED.
async function writeWhileInProgress(auditId: string, write: (tx: any) => Promise<void>): Promise<boolean> {
  return prisma.$transaction(
    async (tx: any) => {
      const [audit] = await tx.$queryRaw`SELECT "status" FROM "InventoryAudit" WHERE "id" = ${auditId} FOR SHARE`;
      if (audit?.status !== 'IN_PROGRESS') return false;
      await write(tx);
      return true;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

// 1. Pre-Audit: Create Inventory Audit
export async function createInventoryAudit(
  prevState: ActionState<{ auditId: string }>,
  formData: FormData
): Promise<ActionResult<{ auditId: string }>> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
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
        description: description || undefined,
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
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
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

    // Get ALL products in the system so they can be counted even if not yet in this warehouse
    const allProducts = await prisma.product.findMany({
      orderBy: { name: 'asc' },
    });

    const inventoryMap = new Map<string, { quantity: number }>(inventoryItems.map((i: any) => [i.productId, i]));

    // Snapshots only for products that actually have inventory in this warehouse
    const snapshots = inventoryItems.map((item: any) => ({
      auditId,
      productId: item.productId,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
      costPrice: item.product.costPrice,
    }));

    await prisma.$transaction(async (tx: any) => {
      // Create snapshots
      await tx.inventoryAuditSnapshot.createMany({
        data: snapshots,
      });

      // Create audit items for ALL products (quantity 0 for those not in this warehouse)
      const auditItems = allProducts.map((product: any) => ({
        auditId,
        productId: product.id,
        systemQuantity: inventoryMap.get(product.id)?.quantity ?? 0,
      }));

      await tx.inventoryAuditItem.createMany({
        data: auditItems,
        skipDuplicates: true,
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
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
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
      const productBarcode = item?.product?.barcode ?? undefined;
      const barcode = generateTagBarcode(auditId, i + 1, productBarcode);
      tags.push({
        auditId,
        barcode,
        tagType,
        productId: item?.productId || undefined,
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
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
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

    if (session.user.role !== 'ADMIN' && audit.createdBy !== session.user.id) {
      return { success: false, message: 'دسترسی غیرمجاز — فقط سازنده انبارگردانی یا مدیر سیستم می‌تواند تیم را تغییر دهد.' };
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
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { createdBy: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (session.user.role !== 'ADMIN' && audit.createdBy !== session.user.id) {
      return { success: false, message: 'دسترسی غیرمجاز — فقط سازنده انبارگردانی یا مدیر سیستم می‌تواند تیم را تغییر دهد.' };
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
  await requirePermission('stock.view');
  const [canSeeCost, canSeeSellPrice] = await Promise.all([hasPermission('cost.view'), hasPermission('sales.view')]);
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
        teams: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
            assignedByUser: { select: { id: true, name: true } },
          },
        },
        createdByUser: { select: { id: true, name: true, email: true } },
        _count: { select: { snapshots: true } },
      },
    });

    if (!audit) return undefined;

    return {
      ...audit,
      description: audit.description ?? undefined,
      items: audit.items.map((item: any) => withoutHiddenMoney({
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
      }, canSeeCost, canSeeSellPrice)),
    };
  } catch (error: unknown) {
    console.error('Error fetching inventory audit:', error);
    return undefined;
  }
}

// Get All Audits
export async function getInventoryAudits(warehouseId?: string) {
  await requirePermission('stock.view');
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

    return audits.map((audit: any) => ({
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
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    if (!Number.isInteger(count) || count < 0) {
      return { success: false, message: 'تعداد شمارش باید عدد صحیح و بزرگ‌تر یا برابر صفر باشد.' };
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

    // Update only: a product that is not an item of this audit has no frozen system quantity.
    const auditItem = await prisma.inventoryAuditItem.findUnique({
      where: {
        auditId_productId: {
          auditId,
          productId,
        },
      },
      select: { id: true },
    });

    if (!auditItem) {
      return { success: false, message: 'آیتم انبارگردانی یافت نشد.' };
    }

    // Update audit item
    const updateData: Record<string, number | string | Date> = {
      [`countedQuantity${countRound}`]: count,
      [`countedBy${countRound}`]: session.user.id,
      [`countedAt${countRound}`]: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    const inProgress = await writeWhileInProgress(auditId, async (tx) => {
      await tx.inventoryAuditItem.update({
        where: { id: auditItem.id },
        data: updateData,
      });
    });

    if (!inProgress) {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

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

export type SaveAuditCountsResult =
  | {
      success: true;
      saved: Array<{ productId: string; count: number | null }>;
      conflicts: Array<{ productId: string; theirCount: number | null; theirName: string | null }>;
      refused: Array<{ productId: string; reason: string }>;
    }
  | { success: false; error: string };

// 7b. Execution: Save count totals
// Each save is the product's whole total for the round, or null for "not counted" (undoing a mistaken first scan),
// so sending a batch again changes nothing. It is written only if the stored total is still the base the total
// started from (null: not counted), whoever saved it: the same user in a second tab or device gets a conflict too.
// A conflict comes back with the stored total and the name of who saved it.
export async function saveAuditCounts(
  auditId: string,
  round: 1 | 2 | 3,
  saves: Array<{ productId: string; count: number | null; base: number | null }>
): Promise<SaveAuditCountsResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'لطفاً وارد سیستم شوید.' };
    }

    if (round !== 1 && round !== 2 && round !== 3) {
      return { success: false, error: 'مرحله شمارش نامعتبر است.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { id: true, createdBy: true },
    });

    if (!audit) {
      return { success: false, error: 'انبارگردانی یافت نشد.' };
    }

    if (!(await mayWorkOnAudit(audit, session.user, 'canCount'))) {
      return { success: false, error: 'شما مجوز شمارش ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
    }

    const userId = session.user.id;
    const quantityField = `countedQuantity${round}` as const;
    const byField = `countedBy${round}` as const;
    const atField = `countedAt${round}` as const;
    const result: Extract<SaveAuditCountsResult, { success: true }> = { success: true, saved: [], conflicts: [], refused: [] };

    // The whole batch in one transaction: an error writes none of it, and issuing never runs in between.
    const inProgress = await writeWhileInProgress(auditId, async (tx) => {
      for (const { productId, count, base } of saves) {
        if (count !== null && (!Number.isInteger(count) || count < 0 || count > 100000)) {
          result.refused.push({ productId, reason: 'تعداد باید عدد صحیح از 0 تا 100000 باشد.' });
          continue;
        }

        // updateMany drops an undefined filter, which would match every item of the audit.
        if (typeof productId !== 'string') {
          result.refused.push({ productId, reason: 'این کالا جزو اقلام این انبارگردانی نیست.' });
          continue;
        }

        const written = await tx.inventoryAuditItem.updateMany({
          where: { auditId, productId, [quantityField]: base ?? null },
          data:
            count === null
              ? { [quantityField]: null, [byField]: null, [atField]: null }
              : { [quantityField]: count, [byField]: userId, [atField]: new Date() },
        });

        if (written.count === 1) {
          result.saved.push({ productId, count });
          continue;
        }

        const item = await tx.inventoryAuditItem.findUnique({
          where: { auditId_productId: { auditId, productId } },
          include: {
            countedBy1User: { select: { name: true } },
            countedBy2User: { select: { name: true } },
            countedBy3User: { select: { name: true } },
          },
        });

        if (!item) {
          result.refused.push({ productId, reason: 'این کالا جزو اقلام این انبارگردانی نیست.' });
        } else {
          result.conflicts.push({
            productId,
            theirCount: [item.countedQuantity1, item.countedQuantity2, item.countedQuantity3][round - 1],
            theirName: [item.countedBy1User, item.countedBy2User, item.countedBy3User][round - 1]?.name ?? null,
          });
        }
      }
    });

    if (!inProgress) {
      return {
        success: true,
        saved: [],
        conflicts: [],
        refused: saves.map(({ productId }) => ({ productId, reason: 'انبارگردانی در حال انجام نیست.' })),
      };
    }

    return result;
  } catch (error: unknown) {
    console.error('Error saving audit counts:', error);
    return { success: false, error: 'خطا در ذخیره شمارش. لطفاً دوباره تلاش کنید.' };
  }
}

// 8. Execution: Set Final Quantity (after multiple counts)
export async function setFinalQuantity(
  auditId: string,
  productId: string,
  finalQuantity: number
): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    if (!Number.isInteger(finalQuantity) || finalQuantity < 0) {
      return { success: false, message: 'مقدار نهایی باید عدد صحیح و بزرگ‌تر یا برابر صفر باشد.' };
    }

    // ADMIN, the creator, or a team member who may approve
    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { id: true, createdBy: true, status: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    if (!(await mayWorkOnAudit(audit, session.user, 'canApprove'))) {
      return { success: false, message: 'شما مجوز تأیید ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
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

    const inProgress = await writeWhileInProgress(auditId, async (tx) => {
      await tx.inventoryAuditItem.update({
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
    });

    if (!inProgress) {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

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

// 8b. Execution: Finalise every counted item from its latest round
export async function finalizeAllFromLastCount(auditId: string): Promise<ActionResult<{ finalizedCount: number }>> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { id: true, createdBy: true, status: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (!(await mayWorkOnAudit(audit, session.user, 'canApprove'))) {
      return { success: false, message: 'شما مجوز تأیید ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
    }

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    // One statement, under the audit lock: nothing changes while or after the audit is issued.
    let finalizedCount = 0;
    const inProgress = await writeWhileInProgress(auditId, async (tx) => {
      finalizedCount = await tx.$executeRaw`
        UPDATE "InventoryAuditItem" AS i
           SET "finalQuantity" = COALESCE(i."countedQuantity3", i."countedQuantity2", i."countedQuantity1"),
               "discrepancy" = COALESCE(i."countedQuantity3", i."countedQuantity2", i."countedQuantity1") - i."systemQuantity",
               "discrepancyValue" = (COALESCE(i."countedQuantity3", i."countedQuantity2", i."countedQuantity1") - i."systemQuantity") * p."costPrice",
               "updatedAt" = now() AT TIME ZONE 'UTC'
          FROM "Product" AS p, "InventoryAudit" AS a
         WHERE p."id" = i."productId" AND a."id" = i."auditId" AND a."status" = 'IN_PROGRESS'
           AND i."auditId" = ${auditId} AND i."finalQuantity" IS NULL
           AND COALESCE(i."countedQuantity3", i."countedQuantity2", i."countedQuantity1") IS NOT NULL`;
    });

    if (!inProgress) {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: `مقدار نهایی ${finalizedCount} آیتم از آخرین شمارش ثبت شد.`,
      data: { finalizedCount },
    };
  } catch (error: unknown) {
    console.error('Error finalizing audit items:', error);
    return {
      success: false,
      message: 'خطا در ثبت مقدار نهایی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 8c. Execution: Set 0 as the final quantity of listed items that nobody counted
export async function setZeroForUncounted(
  auditId: string,
  productIds: string[]
): Promise<ActionResult<{ updatedCount: number }>> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: auditId },
      select: { id: true, createdBy: true, status: true },
    });

    if (!audit) {
      return { success: false, message: 'انبارگردانی یافت نشد.' };
    }

    if (!(await mayWorkOnAudit(audit, session.user, 'canApprove'))) {
      return { success: false, message: 'شما مجوز تأیید ندارید. لطفاً از بخش "پیش از عملیات" خود را به تیم اضافه کنید.' };
    }

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    // One statement, under the audit lock: nothing changes while or after the audit is issued.
    let updatedCount = 0;
    const inProgress = await writeWhileInProgress(auditId, async (tx) => {
      updatedCount = await tx.$executeRaw`
        UPDATE "InventoryAuditItem" AS i
           SET "finalQuantity" = 0,
               "discrepancy" = -i."systemQuantity",
               "discrepancyValue" = -i."systemQuantity" * p."costPrice",
               "updatedAt" = now() AT TIME ZONE 'UTC'
          FROM "Product" AS p, "InventoryAudit" AS a
         WHERE p."id" = i."productId" AND a."id" = i."auditId" AND a."status" = 'IN_PROGRESS'
           AND i."auditId" = ${auditId} AND i."productId" = ANY(${productIds})
           AND i."finalQuantity" IS NULL
           AND i."countedQuantity1" IS NULL AND i."countedQuantity2" IS NULL AND i."countedQuantity3" IS NULL`;
    });

    if (!inProgress) {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: `مقدار نهایی ${updatedCount} آیتم شمارش‌نشده صفر ثبت شد.`,
      data: { updatedCount },
    };
  } catch (error: unknown) {
    console.error('Error setting uncounted items to zero:', error);
    return {
      success: false,
      message: 'خطا در ثبت مقدار نهایی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// ==================== POST-AUDIT TASKS ====================

// 9. Post-Audit: Calculate Discrepancies
export async function calculateDiscrepancies(auditId: string): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'لطفاً وارد سیستم شوید.' };
    }

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

    if (audit.status !== 'IN_PROGRESS') {
      return { success: false, message: 'انبارگردانی در حال انجام نیست.' };
    }

    // Calculate discrepancies for all items
    const updates = audit.items.map((item: any) => {
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

    await Promise.all(updates.filter((u: any) => u !== null));

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
  if (!(await hasPermission('stock.view'))) return undefined;
  const [canSeeCost, canSeeSellPrice] = await Promise.all([hasPermission('cost.view'), hasPermission('sales.view')]);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return undefined;
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

    const totalDiscrepancyValue = canSeeCost
      ? audit.items.reduce(
          (sum: any, item: any) => sum + Number(item.discrepancyValue || 0),
          0
        )
      : null;

    const shortageCount = audit.items.filter((item: any) => (item.discrepancy || 0) < 0).length;
    const excessCount = audit.items.filter((item: any) => (item.discrepancy || 0) > 0).length;

    return {
      audit: {
        ...audit,
        items: audit.items.map((item: any) => withoutHiddenMoney(item, canSeeCost, canSeeSellPrice)),
      },
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
export async function issueAdjustmentDocuments(
  auditId: string
): Promise<ActionResult<{ adjustedCount: number; unitsUp: number; unitsDown: number }>> {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'ADMIN') {
      return { success: false, message: 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند اسناد اصلاحی صادر کند.' };
    }

    // Every adjustment in one transaction, so they become visible all at once:
    // the website stock push then sees 10 or more frames going to 0 together and
    // holds them for an admin, instead of sending them in pieces.
    const result = await prisma.$transaction(
      async (tx: any) => {
        // Claim the audit first. A second call (a reload, another device) waits on this row until the first
        // commits, then finds it COMPLETED. A refusal or error below rolls the claim back with everything else.
        const claim = await tx.inventoryAudit.updateMany({
          where: { id: auditId, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedDate: new Date() },
        });
        if (claim.count !== 1) {
          throw new AuditRefusal('اسناد اصلاحی این انبارگردانی قبلاً صادر شده یا انبارگردانی در حال انجام نیست.');
        }

        const audit = await tx.inventoryAudit.findUnique({
          where: { id: auditId },
          include: {
            items: {
              include: { product: { select: { name: true } } },
              orderBy: { product: { name: 'asc' } },
            },
          },
        });

        const counted = (item: any) =>
          item.countedQuantity1 !== null || item.countedQuantity2 !== null || item.countedQuantity3 !== null;
        const names = (items: any[]) =>
          items.slice(0, 3).map((item) => `«${item.product.name}»`).join('، ') +
          (items.length > 3 ? ` و ${items.length - 3} آیتم دیگر` : '');
        const notFinal = audit.items.filter((item: any) => item.finalQuantity === null && counted(item));
        const notCounted = audit.items.filter(
          (item: any) => item.finalQuantity === null && !counted(item) && item.systemQuantity !== 0
        );
        const problems: string[] = [];
        if (notFinal.length > 0) {
          problems.push(`${notFinal.length} آیتم شمارش شده ولی مقدار نهایی ندارد: ${names(notFinal)}. ابتدا مقدار نهایی را ثبت کنید.`);
        }
        if (notCounted.length > 0) {
          problems.push(`${notCounted.length} آیتم با موجودی سیستمی شمارش نشده است: ${names(notCounted)}. آن‌ها را بشمارید یا صفر ثبت کنید.`);
        }
        if (problems.length > 0) {
          throw new AuditRefusal(`اسناد اصلاحی صادر نشد. ${problems.join(' ')}`);
        }

        let adjustedCount = 0;
        let unitsUp = 0;
        let unitsDown = 0;
        for (const item of audit.items) {
          if (item.finalQuantity === null) continue;
          // Positive for excess, negative for shortage; from the final number, not the stored discrepancy
          const adjustment = item.finalQuantity - item.systemQuantity;
          if (adjustment === 0) continue;
          await tx.inventory.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: audit.warehouseId } },
            update: { quantity: { increment: adjustment } },
            create: { productId: item.productId, warehouseId: audit.warehouseId, quantity: adjustment },
          });
          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              fromWarehouseId: adjustment < 0 ? audit.warehouseId : null,
              toWarehouseId: adjustment >= 0 ? audit.warehouseId : null,
              quantity: Math.abs(adjustment),
              type: 'ADJUSTMENT',
              note: `انبارگردانی ${audit.auditNumber}`,
              referenceId: auditId,
              tags: [],
            },
          });
          await tx.inventoryAuditItem.update({
            where: { id: item.id },
            data: { isAdjusted: true, adjustmentDocId: `ADJ-${auditId}-${item.productId}` },
          });
          adjustedCount++;
          if (adjustment > 0) unitsUp += adjustment;
          else unitsDown -= adjustment;
        }
        return { adjustedCount, unitsUp, unitsDown };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    kickSiteHook();
    revalidatePath('/dashboard/inventory');
    revalidatePath(`/dashboard/inventory/audits/${auditId}`);
    return {
      success: true,
      message: `اسناد اصلاحی برای ${result.adjustedCount} آیتم صادر شد (${result.unitsUp} عدد افزایش، ${result.unitsDown} عدد کاهش).`,
      data: result,
    };
  } catch (error: unknown) {
    if (error instanceof AuditRefusal) {
      return { success: false, message: error.message };
    }
    console.error('Error issuing adjustment documents:', error);
    return {
      success: false,
      message: 'خطا در صدور اسناد اصلاحی. لطفاً دوباره تلاش کنید.',
    };
  }
}

// 12. Post-Audit: Get Performance Report
export async function getPerformanceReport(auditId: string) {
  if (!(await hasPermission('stock.view'))) return undefined;
  const [canSeeCost, canSeeSellPrice] = await Promise.all([hasPermission('cost.view'), hasPermission('sales.view')]);
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
    const countedItems = audit.items.filter((item: any) => item.finalQuantity !== null).length;
    const itemsWithDiscrepancy = audit.items.filter(
  (item: any) => item.discrepancy !== null && item.discrepancy !== 0
    ).length;

    // Count by user
    const countByUser: Record<string, { name: string; count: number }> = {};
    audit.items.forEach((item: any) => {
      [item.countedBy1User, item.countedBy2User, item.countedBy3User].forEach((user: any) => {
        if (user) {
          if (!countByUser[user.id]) {
            countByUser[user.id] = { name: user.name, count: 0 };
          }
          countByUser[user.id].count++;
        }
      });
    });

    return {
      audit: {
        ...audit,
        items: audit.items.map((item: any) => withoutHiddenMoney(item, canSeeCost, canSeeSellPrice)),
      },
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

