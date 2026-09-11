-- Product columns created here, ahead of `prisma db push`, so db push finds
-- nothing to do. It is the migration of record for them.
--
-- webId: the build runs db push without --accept-data-loss, on purpose, and db
-- push refuses to add a unique index to an existing table without that flag,
-- so the deploy would fail. The index gets the exact name Prisma expects.
-- imageUrl, siteUrl: plain nullable columns, added here too so that adding them
-- gets the same short lock_timeout instead of queueing live traffic.
--
-- It runs on every deploy, so it reads the catalog before any DDL: once the
-- columns and index exist it takes no lock on Product at all. (ADD COLUMN IF
-- NOT EXISTS would take an exclusive lock before checking, and stall the live
-- app behind any open transaction.) On the deploy that adds them, a busy table
-- fails the build fast instead of queueing traffic; the next deploy retries.
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Product"'::regclass AND attname = 'imageUrl' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Product" ADD COLUMN "imageUrl" TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Product"'::regclass AND attname = 'siteUrl' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Product" ADD COLUMN "siteUrl" TEXT;
    END IF;
  END IF;
END $$;
