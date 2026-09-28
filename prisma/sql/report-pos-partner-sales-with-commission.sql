-- READ-ONLY REPORT. Not run by the build; nothing here changes data.
--
-- A sale rung up at the POS to a consignment partner used to book a
-- commission (ConsignmentCommission, written unpaid) through the partner's
-- default channel, and to appear in the consignment settlement list, where the
-- partner was asked for the price less that commission. Pooyan's rule since
-- 2026-09-28: a POS sale to a partner is an ordinary sale; the partner owes
-- the full price and no commission is taken. These are the POS sales to
-- partners that still carry a commission row.
--
-- A POS sale is told from a consignment report by its lines: every line of
-- the order comes from one of our own (not virtual) warehouses. Commission
-- rows the POS wrote are also the only ones written unpaid (isPaid = false);
-- the second query lists those whatever their lines say (e.g. lines from
-- before OrderItem.warehouseId was recorded).
--
-- stored_total = gross_of_lines means the order is still stored at its full
-- price; stored_total below it usually means a settlement took the net and
-- normalised the total, i.e. the partner paid the price less the commission.
--
-- Run it with psql against the database, e.g.:
--   psql "$DATABASE_URL" -f prisma/sql/report-pos-partner-sales-with-commission.sql

-- 1. POS sales to a partner (every line from our own warehouse) with a commission row.
SELECT
  o."number"                AS order_number,
  o."createdAt"             AS sold_at,
  c."name"                  AS partner,
  o."status"                AS order_status,
  o."paymentStatus"         AS payment_status,
  o."totalAmount"           AS stored_total,
  o."discount"              AS discount,
  o."paidAmount"            AS paid,
  (SELECT SUM(oi."quantity" * oi."price") FROM "OrderItem" oi WHERE oi."orderId" = o."id") AS gross_of_lines,
  cc."commissionRate"       AS commission_rate,
  cc."channelName"          AS channel,
  cc."commissionAmount"     AS commission_amount,
  cc."isPaid"               AS commission_marked_paid
FROM "ConsignmentCommission" cc
JOIN "Order" o ON o."id" = cc."orderId"
LEFT JOIN "Customer" c ON c."id" = o."customerId"
WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id")
  AND NOT EXISTS (
    SELECT 1 FROM "OrderItem" oi
    LEFT JOIN "Warehouse" w ON w."id" = oi."warehouseId"
    WHERE oi."orderId" = o."id" AND (w."id" IS NULL OR w."isVirtual")
  )
ORDER BY o."createdAt" DESC;

-- 2. Every commission row written unpaid (only the POS wrote those), with where its lines came from.
SELECT
  o."number"                AS order_number,
  o."createdAt"             AS sold_at,
  c."name"                  AS partner,
  o."status"                AS order_status,
  o."paymentStatus"         AS payment_status,
  cc."commissionAmount"     AS commission_amount,
  (SELECT string_agg(DISTINCT COALESCE(w."name", '(no warehouse)'), ', ')
     FROM "OrderItem" oi LEFT JOIN "Warehouse" w ON w."id" = oi."warehouseId"
    WHERE oi."orderId" = o."id") AS line_warehouses
FROM "ConsignmentCommission" cc
JOIN "Order" o ON o."id" = cc."orderId"
LEFT JOIN "Customer" c ON c."id" = o."customerId"
WHERE cc."isPaid" = false
ORDER BY o."createdAt" DESC;
