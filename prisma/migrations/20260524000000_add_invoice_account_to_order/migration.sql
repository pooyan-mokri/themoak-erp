-- AlterTable: add invoiceAccountId to Order for credit invoice bank details
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceAccountId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_invoiceAccountId_fkey'
  ) THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_invoiceAccountId_fkey"
      FOREIGN KEY ("invoiceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
