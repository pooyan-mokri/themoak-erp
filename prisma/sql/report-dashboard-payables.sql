-- READ-ONLY report. Not part of the build; changes nothing.
--
-- The dashboard «بدهی‌ها» used to add the full totalAmount (in the order's
-- first item's currency, so dollars for a dollar order) of every RECEIVED
-- purchase order. It now adds, over every order that is not DRAFT or
-- CANCELLED, its Toman total less its PurchaseOrderPayment rows, never below 0.
--
-- One row per such order, with the old and the new contribution. Look at:
--   * status PAID / IN_PRODUCTION / ARRIVED / RECEIVED with unpaid > 0: marked
--     paid (updatePurchaseOrderStatus can set PAID with no payment) or received
--     with no payment recorded in the ERP;
--   * totalAmountInToman IS NULL (old orders): the dashboard prices them from
--     their lines and order costs at the latest rate, as the payment code does;
--     unpaid_now shows them as 0 here;
--   * paid > total: overpaid, counted as 0; a remainder of 1 Toman or less is
--     rounding (the payment code marks an order paid at total − 1): 0.
SELECT
  po."number",
  s."name"                                   AS supplier,
  po."status",
  po."totalAmount"                           AS total_in_first_item_currency,
  po."totalAmountInToman"                    AS total_toman,
  COALESCE(p.paid, 0)                        AS paid_toman,
  CASE WHEN COALESCE(po."totalAmountInToman", 0) - COALESCE(p.paid, 0) > 1
       THEN COALESCE(po."totalAmountInToman", 0) - COALESCE(p.paid, 0) ELSE 0 END AS unpaid_now,
  CASE WHEN po."status" = 'RECEIVED' THEN po."totalAmount" ELSE 0 END     AS counted_before,
  po."paymentTransactionId" IS NOT NULL      AS has_legacy_payment_pointer
FROM "PurchaseOrder" po
JOIN "Supplier" s ON s."id" = po."supplierId"
LEFT JOIN (
  SELECT "purchaseOrderId", SUM("amount") AS paid FROM "PurchaseOrderPayment" GROUP BY "purchaseOrderId"
) p ON p."purchaseOrderId" = po."id"
WHERE po."status" NOT IN ('DRAFT', 'CANCELLED')
ORDER BY unpaid_now DESC, po."number";
