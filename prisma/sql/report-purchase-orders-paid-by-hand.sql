-- READ-ONLY report. Not part of the build; run it by hand.
--
-- Purchase orders whose status says they were paid, but whose payments do not
-- cover their total. The status page used to allow PENDING_PAYMENT -> PAID or
-- PARTIALLY_PAID by hand, with no payment recorded; production, arrival and
-- receipt all follow PAID, so such an order may have moved on since. Paid
-- statuses now come only from recording payments: record what was actually
-- paid (from the account it left) for each row below. "unpaid" is in Toman.
-- (Orders marked RECEIVED by hand are in report-purchase-receipts.sql.)
SELECT po."number",
       po."status",
       po."createdAt",
       s."name" AS "supplier",
       po."totalAmountInToman",
       COALESCE(pay."paid", 0) AS "paid",
       po."totalAmountInToman" - COALESCE(pay."paid", 0) AS "unpaid"
FROM "PurchaseOrder" po
JOIN "Supplier" s ON s."id" = po."supplierId"
LEFT JOIN (
  SELECT "purchaseOrderId", SUM("amount") AS "paid"
  FROM "PurchaseOrderPayment"
  GROUP BY "purchaseOrderId"
) pay ON pay."purchaseOrderId" = po."id"
WHERE po."status" IN ('PARTIALLY_PAID', 'PAID', 'IN_PRODUCTION', 'ARRIVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
  AND (
    (po."status" = 'PARTIALLY_PAID' AND COALESCE(pay."paid", 0) = 0)
    OR (po."status" <> 'PARTIALLY_PAID' AND COALESCE(pay."paid", 0) < COALESCE(po."totalAmountInToman", 0) - 1)
  )
ORDER BY po."number";
