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
END $$;
