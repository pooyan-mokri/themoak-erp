-- READ-ONLY report. Not part of the build; run it by hand.
--
-- Products whose cost or sell price is 0 although they hold stock or were sold.
-- The Excel import set both prices to 0 on every existing product whenever the
-- sheet had no price column (a stock-role export has none) or the cell was in
-- Persian digits. A 0 cost prices stock and COGS at nothing; a 0 sell price
-- shows the frame as free. Some rows may be legitimately 0; check each against
-- the last purchase (PurchaseOrderItem.unitCostInToman) and the website price.
SELECT p."sku",
       p."name",
       p."productType",
       p."costPrice",
       p."sellPrice",
       COALESCE((SELECT SUM(i."quantity") FROM "Inventory" i WHERE i."productId" = p."id"), 0) AS "stock",
       (SELECT COUNT(*) FROM "OrderItem" oi WHERE oi."productId" = p."id") AS "saleLines",
       (SELECT poi."unitCostInToman" FROM "PurchaseOrderItem" poi
          JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
         WHERE poi."productId" = p."id" ORDER BY po."createdAt" DESC LIMIT 1) AS "lastPurchaseUnitCostInToman",
       p."updatedAt"
FROM "Product" p
WHERE (p."costPrice" = 0 OR p."sellPrice" = 0)
  AND (EXISTS (SELECT 1 FROM "Inventory" i WHERE i."productId" = p."id" AND i."quantity" <> 0)
       OR EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = p."id"))
ORDER BY p."updatedAt" DESC;
