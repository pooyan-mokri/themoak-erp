import { WEB_ID_PATTERN } from './web-id';
import type { WebIdSeedRow } from './web-id-seed';

export type SeedProduct = { id: string; sku: string; name: string; webId: string | null };

export type SeedStatus =
  | 'SET' // will receive the webId
  | 'ALREADY_SET' // already has exactly this webId: nothing to do
  | 'NOT_FOUND' // no product with this id
  | 'SKU_MISMATCH' // the id exists but its SKU changed since the file was made
  | 'HAS_OTHER_WEBID' // the product already holds a different webId (immutable)
  | 'WEBID_TAKEN' // another product already holds this webId
  | 'BAD_FORMAT'
  | 'DUPLICATE_IN_FILE';

export const SEED_STATUS_LABEL: Record<SeedStatus, string> = {
  SET: 'آمادهٔ ثبت',
  ALREADY_SET: 'از قبل ثبت‌شده',
  NOT_FOUND: 'کالا پیدا نشد',
  SKU_MISMATCH: 'SKU عوض شده',
  HAS_OTHER_WEBID: 'شناسهٔ دیگری دارد',
  WEBID_TAKEN: 'شناسه مال کالای دیگری است',
  BAD_FORMAT: 'قالب شناسه نامعتبر',
  DUPLICATE_IN_FILE: 'تکراری در فایل',
};

export type SeedPlanRow = WebIdSeedRow & {
  status: SeedStatus;
  currentSku?: string;
  currentName?: string;
  currentWebId?: string | null;
  takenBy?: string;
};

export type SeedPlan = {
  rows: SeedPlanRow[];
  counts: {
    total: number;
    toSet: number;
    alreadySet: number;
    notFound: number;
    skuMismatch: number;
    conflicts: number;
    duplicates: number;
    badFormat: number;
  };
  problems: number;
  canApply: boolean;
};

/**
 * Decide, row by row, what seeding would do, without writing anything.
 *
 * The rule from the brief: write only when every row lines up. A missing
 * product, a duplicate, a SKU that drifted or a conflicting webId blocks the
 * whole file, so a person looks before anything is written.
 */
export function planWebIdSeed(seed: WebIdSeedRow[], products: SeedProduct[]): SeedPlan {
  const byId = new Map(products.map((p) => [p.id, p]));
  const byWebId = new Map(products.filter((p) => p.webId).map((p) => [p.webId as string, p]));
  const tally = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const webIdCount = tally(seed.map((r) => r.webId));
  const idCount = tally(seed.map((r) => r.erpProductId));

  const rows = seed.map((row): SeedPlanRow => {
    const product = byId.get(row.erpProductId);
    const base = {
      ...row,
      currentSku: product?.sku,
      currentName: product?.name,
      currentWebId: product?.webId ?? null,
    };
    if ((webIdCount.get(row.webId) ?? 0) > 1 || (idCount.get(row.erpProductId) ?? 0) > 1) {
      return { ...base, status: 'DUPLICATE_IN_FILE' };
    }
    if (!WEB_ID_PATTERN.test(row.webId)) return { ...base, status: 'BAD_FORMAT' };
    if (!product) return { ...base, status: 'NOT_FOUND' };
    if (product.sku !== row.erpSku) return { ...base, status: 'SKU_MISMATCH' };
    if (product.webId === row.webId) return { ...base, status: 'ALREADY_SET' };
    if (product.webId) return { ...base, status: 'HAS_OTHER_WEBID' };
    const holder = byWebId.get(row.webId);
    if (holder && holder.id !== product.id) {
      return { ...base, status: 'WEBID_TAKEN', takenBy: `${holder.name} (${holder.sku})` };
    }
    return { ...base, status: 'SET' };
  });

  const n = (s: SeedStatus) => rows.filter((r) => r.status === s).length;
  const counts = {
    total: rows.length,
    toSet: n('SET'),
    alreadySet: n('ALREADY_SET'),
    notFound: n('NOT_FOUND'),
    skuMismatch: n('SKU_MISMATCH'),
    conflicts: n('HAS_OTHER_WEBID') + n('WEBID_TAKEN'),
    duplicates: n('DUPLICATE_IN_FILE'),
    badFormat: n('BAD_FORMAT'),
  };
  const problems =
    counts.notFound + counts.skuMismatch + counts.conflicts + counts.duplicates + counts.badFormat;
  return { rows, counts, problems, canApply: problems === 0 && counts.toSet > 0 };
}
