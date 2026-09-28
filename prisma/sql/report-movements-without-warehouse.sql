-- READ-ONLY report. Not part of the build; run it by hand.
--
-- Stock movements whose warehouse was blanked by deleting that warehouse.
-- InventoryMovement.fromWarehouseId/toWarehouseId reference Warehouse ON DELETE
-- SET NULL, and deleteWarehouse used to rely on a foreign-key error that never
-- came, so deleting a warehouse with history nulled these columns. Every
-- movement has at least one side, and a TRANSFER always has both, so the rows
-- below lost a warehouse. Their product's stock no longer adds up from its
-- movements; the note and createdAt say what they were.
SELECT m."id",
       m."type",
       m."createdAt",
       p."sku",
       p."name" AS "product",
       m."quantity",
       m."fromWarehouseId",
       m."toWarehouseId",
       m."referenceId",
       m."note"
FROM "InventoryMovement" m
JOIN "Product" p ON p."id" = m."productId"
WHERE (m."fromWarehouseId" IS NULL AND m."toWarehouseId" IS NULL)
   OR (m."type" = 'TRANSFER' AND (m."fromWarehouseId" IS NULL OR m."toWarehouseId" IS NULL))
ORDER BY m."createdAt";
