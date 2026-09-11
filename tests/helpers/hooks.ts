import { prisma } from '@/lib/prisma';

type QueryParams = { model?: string; action: string; args?: unknown };

/**
 * One Prisma middleware for the whole test process, so a test can step in right
 * before a query runs, to simulate a concurrent write or a failure. A test sets
 * `beforeQuery.fn` and must reset it to null.
 */
export const beforeQuery: { fn: ((params: QueryParams) => Promise<void>) | null } = { fn: null };

prisma.$use(async (params: any, next: any) => {
  if (beforeQuery.fn) await beforeQuery.fn(params);
  return next(params);
});
