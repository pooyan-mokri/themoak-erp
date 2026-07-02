-- Idempotent healing migration.
-- The production database desynced from the migration history (columns from
-- several prior migrations went missing while those migrations stayed marked
-- as applied). This migration re-ensures every affected column/table exists,
-- using IF NOT EXISTS / pg_constraint guards so it is a safe no-op when they
-- are already present.

-- ── Account: bank card / IBAN ────────────────────────────────────────────────
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "cardNumber" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "sheba" TEXT;

-- ── Transaction: tags + payee ────────────────────────────────────────────────
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "payee" TEXT;

-- ── Order: tags + invoice account ────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceAccountId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_invoiceAccountId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_invoiceAccountId_fkey"
      FOREIGN KEY ("invoiceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── PurchaseOrder / InventoryMovement: tags ──────────────────────────────────
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── Warehouse: archive fields ────────────────────────────────────────────────
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- ── PurchaseOrderPayment table (partial payments) ────────────────────────────
CREATE TABLE IF NOT EXISTS "PurchaseOrderPayment" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrderPayment_transactionId_key" ON "PurchaseOrderPayment"("transactionId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderPayment_purchaseOrderId_idx" ON "PurchaseOrderPayment"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderPayment_accountId_idx" ON "PurchaseOrderPayment"("accountId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderPayment_purchaseOrderId_fkey') THEN
    ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderPayment_accountId_fkey') THEN
    ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderPayment_transactionId_fkey') THEN
    ALTER TABLE "PurchaseOrderPayment" ADD CONSTRAINT "PurchaseOrderPayment_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
