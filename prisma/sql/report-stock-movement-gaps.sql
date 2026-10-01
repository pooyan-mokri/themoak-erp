-- READ-ONLY report. Not part of the build; changes nothing.
--
-- How far each product's stock-movement history in each warehouse is from its
-- stock: net movements (units in − units out, InventoryMovement) against
-- Inventory.quantity. History started late (no movement before July 2026, and
-- none for purchases received the old way), and some events never wrote one
-- (datafix-2026-10-01-movement-history.sql rebuilt what could be placed), so
-- a gap is expected; it says how much of a warehouse's stock its history
-- cannot explain. gap = stock − net movements.
--
-- 1. Per warehouse: product lines that differ, and the units.
-- 2. Every product and warehouse that differs, the largest first.
WITH net AS (
  SELECT "productId", warehouse, SUM(units) AS units FROM (
    SELECT "productId", "toWarehouseId" AS warehouse, quantity AS units FROM "InventoryMovement" WHERE "toWarehouseId" IS NOT NULL
    UNION ALL
    SELECT "productId", "fromWarehouseId", -quantity FROM "InventoryMovement" WHERE "fromWarehouseId" IS NOT NULL
  ) moves GROUP BY 1, 2
), gaps AS (
  SELECT COALESCE(i."productId", n."productId") AS "productId",
         COALESCE(i."warehouseId", n.warehouse) AS "warehouseId",
         COALESCE(i.quantity, 0) AS stock,
         COALESCE(n.units, 0) AS net_movements,
         COALESCE(i.quantity, 0) - COALESCE(n.units, 0) AS gap
  FROM "Inventory" i
  FULL JOIN net n ON n."productId" = i."productId" AND n.warehouse = i."warehouseId"
)
SELECT w.name AS warehouse, w."isVirtual", w."isArchived",
       count(*) AS products_differing, SUM(g.gap) AS net_gap, SUM(abs(g.gap)) AS units_differing,
       SUM(g.stock) AS stock
FROM gaps g JOIN "Warehouse" w ON w.id = g."warehouseId"
WHERE g.gap <> 0
GROUP BY w.id, w.name, w."isVirtual", w."isArchived"
ORDER BY units_differing DESC, w.name;

WITH net AS (
  SELECT "productId", warehouse, SUM(units) AS units FROM (
    SELECT "productId", "toWarehouseId" AS warehouse, quantity AS units FROM "InventoryMovement" WHERE "toWarehouseId" IS NOT NULL
    UNION ALL
    SELECT "productId", "fromWarehouseId", -quantity FROM "InventoryMovement" WHERE "fromWarehouseId" IS NOT NULL
  ) moves GROUP BY 1, 2
), gaps AS (
  SELECT COALESCE(i."productId", n."productId") AS "productId",
         COALESCE(i."warehouseId", n.warehouse) AS "warehouseId",
         COALESCE(i.quantity, 0) AS stock,
         COALESCE(n.units, 0) AS net_movements,
         COALESCE(i.quantity, 0) - COALESCE(n.units, 0) AS gap
  FROM "Inventory" i
  FULL JOIN net n ON n."productId" = i."productId" AND n.warehouse = i."warehouseId"
)
SELECT w.name AS warehouse, p.sku, g.stock, g.net_movements, g.gap
FROM gaps g
JOIN "Warehouse" w ON w.id = g."warehouseId"
JOIN "Product" p ON p.id = g."productId"
WHERE g.gap <> 0
ORDER BY abs(g.gap) DESC, w.name, p.sku;
