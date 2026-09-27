-- READ-ONLY REPORT. Not run by the build; nothing here changes data.
--
-- Until createOrder wrote a SALE movement for each sold line, a sale made at
-- the POS took its stock without leaving a row in InventoryMovement, so the
-- warehouse history misses it (while a cancel of it did write a RETURN).
-- These are the sold lines with no SALE movement of their order and product:
-- POS sales, and also lines added by an exchange (order-exchange.ts writes no
-- movement either) and old gifts booked as 0-price orders. Website sales and
-- consignment reports have always written theirs and do not show up.
--
-- Run it with psql against the database, e.g.:
--   psql "$DATABASE_URL" -f prisma/sql/report-pos-sales-without-movements.sql

-- 1. Totals per warehouse and kind of line.
SELECT
  COALESCE(w."name", '(no warehouse)')                                  AS warehouse,
  CASE WHEN x."id" IS NOT NULL THEN 'exchange line' ELSE 'sold line' END AS kind,
  COUNT(*)                                                              AS lines,
  SUM(oi."quantity")                                                    AS units,
  COUNT(DISTINCT o."id")                                                AS orders,
  MIN(o."createdAt")                                                    AS first_sale,
  MAX(o."createdAt")                                                    AS last_sale
FROM "OrderItem" oi
JOIN "Order" o ON o."id" = oi."orderId"
LEFT JOIN "Warehouse" w ON w."id" = oi."warehouseId"
LEFT JOIN "OrderExchange" x ON x."exchangeItemId" = oi."id"
WHERE o."siteReference" IS NULL
  AND o."wooId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "InventoryMovement" m
    WHERE m."type" = 'SALE' AND m."referenceId" = o."id" AND m."productId" = oi."productId"
  )
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2. The lines themselves, newest first.
SELECT
  o."number"                   AS order_number,
  o."createdAt"                AS sold_at,
  o."status"                   AS order_status,
  c."name"                     AS customer,
  p."sku"                      AS sku,
  p."name"                     AS product,
  COALESCE(w."name", '(none)') AS warehouse,
  oi."quantity"                AS quantity,
  (x."id" IS NOT NULL)         AS from_exchange
FROM "OrderItem" oi
JOIN "Order" o ON o."id" = oi."orderId"
JOIN "Product" p ON p."id" = oi."productId"
LEFT JOIN "Customer" c ON c."id" = o."customerId"
LEFT JOIN "Warehouse" w ON w."id" = oi."warehouseId"
LEFT JOIN "OrderExchange" x ON x."exchangeItemId" = oi."id"
WHERE o."siteReference" IS NULL
  AND o."wooId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "InventoryMovement" m
    WHERE m."type" = 'SALE' AND m."referenceId" = o."id" AND m."productId" = oi."productId"
  )
ORDER BY o."createdAt" DESC, o."number" DESC;
