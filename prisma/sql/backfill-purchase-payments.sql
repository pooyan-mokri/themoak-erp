-- Backfill PurchaseOrderPayment rows for orders that were paid through the
-- original full-payment flow, before partial payments existed. Those orders
-- carry a payment Transaction (PurchaseOrder.paymentTransactionId) but no
-- payment record, so the order detail reported 0 paid and showed the full
-- amount as still owing even though the order was marked PAID.
--
-- Idempotent: skips any order that already has payment rows, and skips
-- transactions already linked to a payment (transactionId is UNIQUE).
INSERT INTO "PurchaseOrderPayment" ("id", "purchaseOrderId", "amount", "accountId", "transactionId", "description", "date", "createdAt")
SELECT
  'bf_' || po."id",
  po."id",
  t."amountInToman",
  COALESCE(po."paymentAccountId", t."accountId"),
  po."paymentTransactionId",
  'پرداخت کامل (ثبت گذشته‌نگر)',
  t."date",
  NOW()
FROM "PurchaseOrder" po
JOIN "Transaction" t ON t."id" = po."paymentTransactionId"
WHERE po."paymentTransactionId" IS NOT NULL
  AND COALESCE(po."paymentAccountId", t."accountId") IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseOrderPayment" p WHERE p."purchaseOrderId" = po."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseOrderPayment" p2 WHERE p2."transactionId" = po."paymentTransactionId"
  );
