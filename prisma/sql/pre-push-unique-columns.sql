-- Columns created here, ahead of `prisma db push`, so db push finds nothing to
-- do for them. It is the migration of record for them.
--
-- webId: the build runs db push without --accept-data-loss, on purpose, and db
-- push refuses to add a unique index to an existing table without that flag,
-- so the deploy would fail. The index gets the exact name Prisma expects.
-- imageUrl, siteUrl: plain nullable columns, added here too so that adding them
-- gets the same short lock_timeout instead of queueing live traffic.
-- Order.siteReference: the website's order reference, unique for the same
-- reason as webId. The other website-sale columns (Customer.siteId, source;
-- Order.siteData, siteRestockedAt) are plain nullable columns, here for the
-- short lock_timeout. Customer comes before Order, the order a live sale takes
-- its locks in.
-- SiteRefund: a new table, created here too so that its foreign keys, which
-- lock Order and Transaction, get the same lock_timeout.
-- SiteHook*: the website stock push (src/lib/site-hook.ts). The triggers write
-- every stock and webId change into SiteHookLog inside the writer's own
-- transaction. Prisma does not manage triggers, so db push neither creates nor
-- drops them. The Product trigger is created before the Inventory one, the
-- order purchase receiving takes its locks in. Dropping the models requires
-- dropping the triggers and the function first.
--
-- It runs on every deploy, so it reads the catalog before any DDL: once the
-- columns and index exist it takes no lock on Product at all. (ADD COLUMN IF
-- NOT EXISTS would take an exclusive lock before checking, and stall the live
-- app behind any open transaction.) On the deploy that adds them, a busy table
-- fails the build fast instead of queueing traffic; the next deploy retries.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  -- Builds that share this database queue here instead of colliding on the DDL below.
  PERFORM pg_advisory_xact_lock(7202609120001);
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
  IF to_regclass('"Customer"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Customer"'::regclass AND attname = 'siteId' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Customer" ADD COLUMN "siteId" TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Customer"'::regclass AND attname = 'source' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Customer" ADD COLUMN "source" TEXT;
    END IF;
  END IF;
  IF to_regclass('"Order"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Order"'::regclass AND attname = 'siteReference' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Order" ADD COLUMN "siteReference" TEXT;
    END IF;
    IF to_regclass('"Order_siteReference_key"') IS NULL THEN
      CREATE UNIQUE INDEX "Order_siteReference_key" ON "Order"("siteReference");
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Order"'::regclass AND attname = 'siteData' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Order" ADD COLUMN "siteData" JSONB;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = '"Order"'::regclass AND attname = 'siteRestockedAt' AND NOT attisdropped
    ) THEN
      ALTER TABLE "Order" ADD COLUMN "siteRestockedAt" TIMESTAMP(3);
    END IF;
  END IF;
  IF to_regclass('"SiteRefund"') IS NULL AND to_regclass('"Order"') IS NOT NULL AND to_regclass('"Transaction"') IS NOT NULL THEN
    CREATE TABLE "SiteRefund" (
      "id" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "refundId" TEXT NOT NULL,
      "transactionId" TEXT,
      "amount" DECIMAL(65,30) NOT NULL,
      "at" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SiteRefund_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "SiteRefund_transactionId_key" ON "SiteRefund"("transactionId");
    CREATE UNIQUE INDEX "SiteRefund_orderId_refundId_key" ON "SiteRefund"("orderId", "refundId");
    ALTER TABLE "SiteRefund" ADD CONSTRAINT "SiteRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "SiteRefund" ADD CONSTRAINT "SiteRefund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF to_regclass('"SiteHookLog"') IS NULL THEN
    CREATE TABLE "SiteHookLog" (
      "id" BIGSERIAL NOT NULL,
      "productId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "warehouseId" TEXT,
      "oldWebId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SiteHookLog_pkey" PRIMARY KEY ("id")
    );
  END IF;
  IF to_regclass('"SiteHookLease"') IS NULL THEN
    CREATE TABLE "SiteHookLease" (
      "id" INTEGER NOT NULL,
      "holder" TEXT,
      "until" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "SiteHookLease_pkey" PRIMARY KEY ("id")
    );
  END IF;
  -- Never empty: a db push from an older schema then stops on its data-loss
  -- check instead of silently dropping these tables under live triggers. The
  -- lease is kept in UTC (src/lib/site-hook.ts).
  INSERT INTO "SiteHookLease" ("id", "holder", "until") VALUES (1, NULL, now() AT TIME ZONE 'UTC') ON CONFLICT ("id") DO NOTHING;
  IF to_regclass('"SiteHookState"') IS NULL THEN
    CREATE TABLE "SiteHookState" (
      "webId" TEXT NOT NULL,
      "quantity" INTEGER,
      "sentAt" TIMESTAMP(3),
      "skipWhy" TEXT,
      "skipAt" TIMESTAMP(3),
      CONSTRAINT "SiteHookState_pkey" PRIMARY KEY ("webId")
    );
  END IF;
  -- kind: 'stock' (a count changed in warehouseId), 'webid' (the product got a
  -- webId), 'retire' (oldWebId left the product), 'resync' (written by the app).
  -- Plain row triggers compared inside the body: a column list or WHEN clause
  -- would block future type changes of those columns. createdAt is written in
  -- UTC explicitly: CURRENT_TIMESTAMP follows the session's time zone, while
  -- Prisma reads the column as UTC.
  CREATE OR REPLACE FUNCTION site_hook_log() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $fn$
  BEGIN
    -- If the log table is ever gone, stock writes must still work.
    IF to_regclass('public."SiteHookLog"') IS NULL THEN
      RETURN NULL;
    END IF;
    IF TG_TABLE_NAME = 'Inventory' THEN
      IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (OLD."productId" <> NEW."productId" OR OLD."warehouseId" <> NEW."warehouseId")) THEN
        INSERT INTO "SiteHookLog" ("productId", "kind", "warehouseId", "createdAt") VALUES (OLD."productId", 'stock', OLD."warehouseId", now() AT TIME ZONE 'UTC');
      END IF;
      IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW."quantity" IS DISTINCT FROM OLD."quantity" OR OLD."productId" <> NEW."productId" OR OLD."warehouseId" <> NEW."warehouseId")) THEN
        INSERT INTO "SiteHookLog" ("productId", "kind", "warehouseId", "createdAt") VALUES (NEW."productId", 'stock', NEW."warehouseId", now() AT TIME ZONE 'UTC');
      END IF;
    ELSE
      IF (TG_OP = 'DELETE' AND OLD."webId" IS NOT NULL) OR (TG_OP = 'UPDATE' AND OLD."webId" IS NOT NULL AND NEW."webId" IS DISTINCT FROM OLD."webId") THEN
        INSERT INTO "SiteHookLog" ("productId", "kind", "oldWebId", "createdAt") VALUES (OLD."id", 'retire', OLD."webId", now() AT TIME ZONE 'UTC');
      END IF;
      IF (TG_OP = 'INSERT' AND NEW."webId" IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW."webId" IS NOT NULL AND NEW."webId" IS DISTINCT FROM OLD."webId") THEN
        INSERT INTO "SiteHookLog" ("productId", "kind", "createdAt") VALUES (NEW."id", 'webid', now() AT TIME ZONE 'UTC');
      END IF;
    END IF;
    RETURN NULL;
  END
  $fn$;
  -- to_regclass, not ::regclass: the cast is evaluated even when the table does
  -- not exist yet, which fails the first run on an empty database.
  IF to_regclass('"Product"') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'site_hook_product' AND tgrelid = to_regclass('"Product"')
  ) THEN
    CREATE TRIGGER site_hook_product AFTER INSERT OR UPDATE OR DELETE ON "Product"
      FOR EACH ROW EXECUTE FUNCTION site_hook_log();
  END IF;
  IF to_regclass('"Inventory"') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'site_hook_inventory' AND tgrelid = to_regclass('"Inventory"')
  ) THEN
    CREATE TRIGGER site_hook_inventory AFTER INSERT OR UPDATE OR DELETE ON "Inventory"
      FOR EACH ROW EXECUTE FUNCTION site_hook_log();
  END IF;
END $$;
