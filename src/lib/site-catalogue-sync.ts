import { fetchSiteCatalogue, planCatalogueSync, type CatalogueSyncResult } from './site-catalogue';
import { readSiteConnection, SITE_CATALOGUE_SYNC_KEY } from './site-connection';

const fa = (n: number) => n.toLocaleString('fa-IR');

/**
 * Read the website's catalogue and store each product's photo and page link by
 * webId. Shared by the manual button and the daily cron. Every run's outcome is
 * saved so the settings page can show when it last ran and what it found.
 *
 * `client` is a Prisma client.
 */
export async function runCatalogueSync(client: any): Promise<CatalogueSyncResult> {
  const at = new Date().toISOString();
  const connection = await readSiteConnection(client);
  let result: CatalogueSyncResult;

  if (!connection.siteUrl || !connection.webhookSecret) {
    result = { ok: false, at, message: 'آدرس سایت یا رمز وبهوک در «تنظیمات › اتصال سایت» ثبت نشده است.' };
  } else {
    const fetched = await fetchSiteCatalogue({ siteUrl: connection.siteUrl, secret: connection.webhookSecret });
    if (!fetched.ok) {
      result = { ok: false, at, message: fetched.message };
    } else {
      // Products without a webId are not even read: they cannot match.
      const products = await client.product.findMany({
        where: { webId: { not: null } },
        select: { id: true, webId: true, imageUrl: true, siteUrl: true },
      });
      const plan = planCatalogueSync(fetched.items, products);
      let updated = 0;
      for (const change of plan.updates) {
        // Match the webId too, so a product whose webId changed meanwhile is left alone.
        const { count } = await client.product.updateMany({
          where: { id: change.id, webId: change.webId },
          data: { imageUrl: change.imageUrl, siteUrl: change.siteUrl },
        });
        updated += count;
      }
      result = {
        ok: true,
        at,
        message: `${fa(fetched.items.length)} کالا از سایت خوانده شد؛ ${fa(updated)} مورد به‌روز شد.`,
        read: fetched.items.length,
        updated,
        unchanged: plan.unchanged,
        notInErp: plan.notInErp,
        notOnSite: plan.notOnSite,
        skipped: fetched.skipped,
      };
    }
  }

  const value = JSON.stringify(result);
  await client.systemSetting.upsert({
    where: { key: SITE_CATALOGUE_SYNC_KEY },
    update: { value },
    create: { key: SITE_CATALOGUE_SYNC_KEY, value },
  });
  return result;
}
