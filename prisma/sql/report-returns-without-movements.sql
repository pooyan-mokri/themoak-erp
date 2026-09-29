-- READ-ONLY report. Not part of the build; changes nothing.
--
-- A return and the goods given back in an exchange put their units back
-- into a warehouse without a row in InventoryMovement, so that warehouse's
-- history misses them and its stock does not add up from its movements.
-- From release/tested each writes a RETURN movement (referenceId = the
-- order). One row per return or exchange whose order has fewer RETURN units
-- of that product than came back (a cancel's restore, also a RETURN of the
-- order, is left out: a cancelled order has no returns). The new goods of
-- an exchange missing their SALE movement are in
-- report-pos-sales-without-movements.sql.
WITH back AS (
  SELECT 'return' AS kind, r."orderId", oi."productId", r.quantity, r."createdAt"
  FROM "OrderReturn" r JOIN "OrderItem" oi ON oi.id = r."orderItemId"
  UNION ALL
  SELECT 'exchange', x."orderId", oi."productId", x.quantity, x."createdAt"
  FROM "OrderExchange" x JOIN "OrderItem" oi ON oi.id = x."originalItemId"
), came_back AS (
  SELECT "orderId", "productId", SUM(quantity) AS units, MIN("createdAt") AS first_at, string_agg(DISTINCT kind, '+') AS kinds
  FROM back GROUP BY 1, 2
), moved AS (
  SELECT "referenceId" AS "orderId", "productId", SUM(quantity) AS units
  FROM "InventoryMovement" WHERE type = 'RETURN' GROUP BY 1, 2
)
SELECT o.number, p.sku, cb.kinds, cb.units AS units_back, COALESCE(m.units, 0) AS units_with_movement,
       cb.first_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran' AS first_back_tehran
FROM came_back cb
JOIN "Order" o ON o.id = cb."orderId"
JOIN "Product" p ON p.id = cb."productId"
LEFT JOIN moved m ON m."orderId" = cb."orderId" AND m."productId" = cb."productId"
WHERE COALESCE(m.units, 0) < cb.units
ORDER BY cb.first_at;
