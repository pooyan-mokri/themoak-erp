-- READ-ONLY report. Not part of the build; changes nothing.
--
-- Profit and loss is on a cost-of-goods-sold basis (src/lib/profit-rows.ts):
-- goods become an expense only through COGS rows. Before release/tested only
-- a consignment partner's reported sale booked one (and, on the test/sales
-- branch, the POS). A website sale and the new goods of an exchange booked
-- none, and a return or restock took nothing off. From now on each does
-- (src/lib/cogs.ts); older sales keep no COGS, so profit for their months is
-- overstated by the cost of their goods. A return of such a sale takes
-- nothing off: it is capped at what the order booked.
--
-- 1. Every uncancelled order whose units still sold cost more, at today's
--    cost price (what the new rows use), than the COGS its rows add up to.
--    A COGS row written before rows carried orderId is matched by its
--    description («… - سفارش #N»).
-- 2. The same, summed per Tehran month and source.
WITH sold AS (
  SELECT oi."orderId",
         SUM(GREATEST(0, oi.quantity - COALESCE(r.q, 0) - COALESCE(x.q, 0)) * p."costPrice") AS cost_now
  FROM "OrderItem" oi
  JOIN "Product" p ON p.id = oi."productId"
  LEFT JOIN (SELECT "orderItemId", SUM(quantity) AS q FROM "OrderReturn" GROUP BY 1) r ON r."orderItemId" = oi.id
  LEFT JOIN (SELECT "originalItemId", SUM(quantity) AS q FROM "OrderExchange" GROUP BY 1) x ON x."originalItemId" = oi.id
  GROUP BY oi."orderId"
), rows AS (
  SELECT o.number,
         to_char(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran', 'YYYY-MM') AS tehran_month,
         CASE
           WHEN o."siteReference" IS NOT NULL THEN 'website'
           WHEN EXISTS (SELECT 1 FROM "OrderItem" i JOIN "Warehouse" w ON w.id = i."warehouseId"
                        WHERE i."orderId" = o.id AND w."isVirtual") THEN 'consignment'
           ELSE 'pos'
         END AS source,
         s.cost_now,
         COALESCE((SELECT SUM(t."amountInToman") FROM "Transaction" t
                   WHERE t.category = 'COGS'
                     AND (t."orderId" = o.id
                          OR (t."orderId" IS NULL AND t.description ~ ('سفارش #' || o.number || '($|[^0-9])')))), 0) AS cogs_booked
  FROM "Order" o
  JOIN sold s ON s."orderId" = o.id
  WHERE o.status <> 'CANCELLED'
)
SELECT number, tehran_month, source,
       ROUND(cost_now) AS cost_of_units_still_sold,
       ROUND(cogs_booked) AS cogs_booked,
       ROUND(cost_now - cogs_booked) AS missing_cogs
FROM rows
WHERE cost_now - cogs_booked > 1
ORDER BY tehran_month, number;

WITH sold AS (
  SELECT oi."orderId",
         SUM(GREATEST(0, oi.quantity - COALESCE(r.q, 0) - COALESCE(x.q, 0)) * p."costPrice") AS cost_now
  FROM "OrderItem" oi
  JOIN "Product" p ON p.id = oi."productId"
  LEFT JOIN (SELECT "orderItemId", SUM(quantity) AS q FROM "OrderReturn" GROUP BY 1) r ON r."orderItemId" = oi.id
  LEFT JOIN (SELECT "originalItemId", SUM(quantity) AS q FROM "OrderExchange" GROUP BY 1) x ON x."originalItemId" = oi.id
  GROUP BY oi."orderId"
), rows AS (
  SELECT to_char(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran', 'YYYY-MM') AS tehran_month,
         CASE
           WHEN o."siteReference" IS NOT NULL THEN 'website'
           WHEN EXISTS (SELECT 1 FROM "OrderItem" i JOIN "Warehouse" w ON w.id = i."warehouseId"
                        WHERE i."orderId" = o.id AND w."isVirtual") THEN 'consignment'
           ELSE 'pos'
         END AS source,
         s.cost_now,
         COALESCE((SELECT SUM(t."amountInToman") FROM "Transaction" t
                   WHERE t.category = 'COGS'
                     AND (t."orderId" = o.id
                          OR (t."orderId" IS NULL AND t.description ~ ('سفارش #' || o.number || '($|[^0-9])')))), 0) AS cogs_booked
  FROM "Order" o
  JOIN sold s ON s."orderId" = o.id
  WHERE o.status <> 'CANCELLED'
)
SELECT tehran_month, source, COUNT(*) AS orders, ROUND(SUM(cost_now - cogs_booked)) AS missing_cogs
FROM rows
WHERE cost_now - cogs_booked > 1
GROUP BY tehran_month, source
ORDER BY tehran_month, source;
