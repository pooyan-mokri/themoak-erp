-- READ-ONLY report. Not part of the build; run it by hand.
--
-- Consumable fixed assets whose value no longer matches what was received for
-- them. Receiving used to overwrite the asset's purchasePrice with the latest
-- receipt's unit cost (every earlier unit revalued at it), and the asset list
-- valued a consumable as one depreciating item. A consumable is now worth
-- quantity × unit cost, a later receipt adding at its own cost.
--
-- "receivedValue" is what the purchase-order lines of the product say was
-- received (landed, in Toman); "valueNow" is quantity × purchasePrice as
-- stored. The rows below differ by a toman or more, or in quantity; a row
-- adjusted by hand on purpose (units used up, written off) may belong here too.
-- The unit cost the receipts support is receivedValue / receivedQuantity.
SELECT fa."id",
       fa."name",
       p."sku",
       fa."quantity",
       fa."purchasePrice",
       fa."quantity" * fa."purchasePrice" AS "valueNow",
       r."receivedQuantity",
       r."receivedValue",
       r."receivedValue" / NULLIF(r."receivedQuantity", 0) AS "unitCostFromReceipts"
FROM "FixedAsset" fa
JOIN "Product" p ON p."id" = fa."productId"
JOIN (
  SELECT "productId", SUM("receivedQuantity") AS "receivedQuantity", SUM(COALESCE("totalCostInToman", 0)) AS "receivedValue"
  FROM "PurchaseOrderItem"
  WHERE "receivedQuantity" > 0
  GROUP BY "productId"
) r ON r."productId" = fa."productId"
WHERE fa."assetType" = 'CONSUMABLE'
  AND (ABS(COALESCE(fa."quantity", 0) * fa."purchasePrice" - r."receivedValue") >= 1
       OR COALESCE(fa."quantity", 0) <> r."receivedQuantity")
ORDER BY fa."name";
