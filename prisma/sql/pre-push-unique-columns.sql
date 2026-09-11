-- The build runs `prisma db push` without --accept-data-loss, on purpose, and
-- db push refuses to add a unique index to an existing table without that
-- flag, so the deploy would fail. This creates Product.webId and its index
-- first, under the exact name Prisma expects, so db push finds nothing to do.
-- It is the migration of record for that column.
--
-- It runs on every deploy, so it reads the catalog before any DDL: once the
-- column and index exist it takes no lock on Product at all. (ADD COLUMN IF
-- NOT EXISTS would take an exclusive lock before checking, and stall the live
-- app behind any open transaction.) On the one deploy that adds them, a short
-- lock_timeout makes a busy table fail the build fast instead of queueing
-- traffic; the next deploy simply retries.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('"Product"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Product"'::regclass AND attname = 'webId' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Product" ADD COLUMN "webId" TEXT;
    END IF;
    IF to_regclass('"Product_webId_key"') IS NULL THEN
      CREATE UNIQUE INDEX "Product_webId_key" ON "Product"("webId");
    END IF;
  END IF;
END $$;
