-- READ-ONLY report. Not part of the build; run it by hand.
--
-- 1. Purchase orders marked RECEIVED or PARTIALLY_RECEIVED with units still
--    not received. Receiving used to judge "all received" from the lines sent
--    in that one receipt, so receiving one line of several in full marked the
--    whole order RECEIVED; the old whole-order receive and a manual
--    ARRIVED -> RECEIVED move set RECEIVED without touching the lines; and a
--    PARTIALLY_RECEIVED order lost its receive button. Each row is a line whose
--    remaining units never reached stock.
SELECT po."number",
       po."status",
       po."createdAt",
       s."name" AS "supplier",
       p."sku",
       p."productType",
       poi."quantity",
       poi."receivedQuantity",
       poi."quantity" - poi."receivedQuantity" AS "notReceived"
FROM "PurchaseOrderItem" poi
JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
JOIN "Supplier" s ON s."id" = po."supplierId"
JOIN "Product" p ON p."id" = poi."productId"
WHERE po."status" IN ('RECEIVED', 'PARTIALLY_RECEIVED')
  AND poi."receivedQuantity" < poi."quantity"
ORDER BY po."number", p."sku";

-- 2. Stock received more than once. Two receipts of the same order at once
--    (a double click, two tabs) could both pass the quantity check: the stock
--    was added twice while receivedQuantity kept one of them. Each row is an
--    order and product whose PURCHASE movements exceed what its lines say was
--    received; "extra" units are in stock that never arrived.
SELECT po."number",
       p."sku",
       lines."received",
       moved."moved",
       moved."moved" - lines."received" AS "extra"
FROM (
  SELECT "purchaseOrderId", "productId", SUM("receivedQuantity") AS "received"
  FROM "PurchaseOrderItem"
  GROUP BY "purchaseOrderId", "productId"
) lines
JOIN (
  SELECT "referenceId", "productId", SUM("quantity") AS "moved"
  FROM "InventoryMovement"
  WHERE "type" = 'PURCHASE'
  GROUP BY "referenceId", "productId"
) moved ON moved."referenceId" = lines."purchaseOrderId" AND moved."productId" = lines."productId"
JOIN "PurchaseOrder" po ON po."id" = lines."purchaseOrderId"
JOIN "Product" p ON p."id" = lines."productId"
WHERE moved."moved" > lines."received"
ORDER BY po."number", p."sku";
