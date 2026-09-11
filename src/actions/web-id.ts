'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { parseWebId, webIdConflictMessage, isWebIdUniqueViolation } from '@/lib/web-id';
import { WEB_ID_SEED } from '@/lib/web-id-seed';
import { planWebIdSeed, type SeedPlan } from '@/lib/web-id-seed-plan';

/** Seeding stopped before writing; the message is safe to show as-is. */
class SeedStoppedError extends Error {
  constructor(message: string, public plan?: SeedPlan) {
    super(message);
  }
}

async function planAgainst(client: any): Promise<SeedPlan> {
  const products = await client.product.findMany({
    select: { id: true, sku: true, name: true, webId: true },
  });
  return planWebIdSeed(WEB_ID_SEED, products);
}

async function requireSignedIn() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
}

function revalidate() {
  revalidatePath('/dashboard/inventory/web-ids');
  revalidatePath('/dashboard/inventory/products');
}

/** What seeding from the bundled file would do right now. Writes nothing. */
export async function getWebIdSeedPreview(): Promise<SeedPlan> {
  await requireSignedIn();
  return planAgainst(prisma);
}

/**
 * Write the file's webIds (admin only). All or nothing. The plan is rebuilt
 * inside the transaction, and it must still show exactly the numbers the admin
 * approved: the brief says that if any other number comes up, nothing is written.
 */
export async function applyWebIdSeed(approved: { total: number; toSet: number }): Promise<{
  success: boolean;
  message: string;
  counts?: SeedPlan['counts'];
}> {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') {
    return { success: false, message: 'فقط مدیر سیستم می‌تواند شناسه‌ها را یک‌جا ثبت کند.' };
  }

  try {
    const counts = await prisma.$transaction(
      async (tx) => {
        const plan = await planAgainst(tx);
        if (plan.problems > 0) {
          throw new SeedStoppedError(
            'فایل با وضعیت فعلی کالاها نمی‌خواند؛ هیچ چیزی نوشته نشد. پیش‌نمایش را دوباره ببینید.',
            plan,
          );
        }
        if (plan.counts.total !== approved.total || plan.counts.toSet !== approved.toSet) {
          throw new SeedStoppedError(
            'عددها از زمان پیش‌نمایش تغییر کرده‌اند؛ هیچ چیزی نوشته نشد. صفحه را تازه کنید و دوباره بررسی کنید.',
            plan,
          );
        }
        for (const row of plan.rows) {
          if (row.status !== 'SET') continue;
          const { count } = await tx.product.updateMany({
            where: { id: row.erpProductId, sku: row.erpSku, webId: null },
            data: { webId: row.webId },
          });
          if (count !== 1) {
            throw new SeedStoppedError(`کالای ${row.erpSku} هم‌زمان تغییر کرد؛ هیچ شناسه‌ای ثبت نشد.`);
          }
        }
        return plan.counts;
      },
      // One read plus up to 91 small writes: Prisma's 5s default is too tight
      // for a remote production database.
      { maxWait: 10_000, timeout: 60_000 },
    );

    revalidate();
    if (counts.toSet === 0) {
      return { success: true, message: 'همهٔ شناسه‌های فایل از قبل ثبت شده بودند؛ چیزی تغییر نکرد.', counts };
    }
    return { success: true, message: `${counts.toSet.toLocaleString('fa-IR')} شناسهٔ سایت ثبت شد.`, counts };
  } catch (error) {
    if (error instanceof SeedStoppedError) {
      return { success: false, message: error.message, counts: error.plan?.counts };
    }
    if (isWebIdUniqueViolation(error)) {
      return { success: false, message: 'یکی از شناسه‌ها هم‌زمان به کالای دیگری داده شد؛ هیچ چیزی نوشته نشد.' };
    }
    if ((error as { code?: string } | null)?.code === 'P2028') {
      return { success: false, message: 'ثبت بیش از حد طول کشید و لغو شد؛ هیچ چیزی نوشته نشد. دوباره تلاش کنید.' };
    }
    console.error('Error applying webId seed:', error);
    return { success: false, message: 'خطا در ثبت شناسه‌ها؛ هیچ چیزی نوشته نشد.' };
  }
}

/** Saleable products the website can't sell yet because they have no webId. */
export async function getProductsWithoutWebId(): Promise<
  Array<{ id: string; name: string; sku: string; sellPrice: number }>
> {
  await requireSignedIn();
  const products = await prisma.product.findMany({
    where: { webId: null, productType: 'SALEABLE' },
    select: { id: true, name: true, sku: true, sellPrice: true },
    orderBy: { name: 'asc' },
  });
  return products.map((p: any) => ({ ...p, sellPrice: Number(p.sellPrice) }));
}

/**
 * Give one product its webId from the "without webId" list. Only fills an
 * empty slot: changing an existing webId goes through the product form, which
 * warns first.
 */
export async function setProductWebId(
  productId: string,
  raw: string,
): Promise<{ success: boolean; message: string }> {
  const session = await auth();
  if (!session?.user) return { success: false, message: 'ابتدا وارد سیستم شوید.' };

  const input = parseWebId(raw);
  if (!input.ok) return { success: false, message: input.message };
  if (!input.value) return { success: false, message: 'شناسهٔ سایت را وارد کنید.' };
  const webId = input.value;

  try {
    const conflict = await webIdConflictMessage(prisma, webId, productId);
    if (conflict) return { success: false, message: conflict };

    const { count } = await prisma.product.updateMany({
      where: { id: productId, webId: null },
      data: { webId },
    });
    if (count === 0) {
      return { success: false, message: 'این کالا پیدا نشد یا در این فاصله شناسه گرفته است؛ صفحه را تازه کنید.' };
    }
    revalidate();
    return { success: true, message: `شناسهٔ «${webId}» ثبت شد.` };
  } catch (error) {
    if (isWebIdUniqueViolation(error)) {
      const message = (await webIdConflictMessage(prisma, webId, productId)) ?? 'این شناسهٔ سایت تکراری است.';
      return { success: false, message };
    }
    console.error('Error setting webId:', error);
    return { success: false, message: 'خطا در ثبت شناسهٔ سایت.' };
  }
}
