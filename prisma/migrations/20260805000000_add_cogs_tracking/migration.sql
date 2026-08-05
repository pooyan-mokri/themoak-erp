-- Capitalization policy: track the COGS booked per sale, and snapshot the landed
-- unit cost onto each sold line so returns/exchanges reverse the exact amount.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cogsTransactionId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costSnapshot" DECIMAL(65,30);
