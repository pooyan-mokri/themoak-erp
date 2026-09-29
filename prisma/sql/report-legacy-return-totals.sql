-- READ-ONLY REPORT. Not run by the build; it changes nothing.
--
-- Orders whose stored total no longer matches their lines, because returns or
-- exchanges on them were booked before commit b78d364 (2026-05-07 18:53 UTC).
-- Run it by hand against production, e.g.
--   psql "$DATABASE_URL" -f prisma/sql/report-legacy-return-totals.sql
--
-- Before b78d364 a return or an exchange moved cash but never touched the
-- order (git show b78d364):
--   - a return paid the full goods value back in cash, even on an unpaid
--     order, and left Order.totalAmount and paidAmount as sold;
--   - an exchange booked its whole price difference as cash, in or out, and
--     added the new line to the order without adding it to the total.
-- Since then each return and exchange rewrites the total, the paid amount and
-- the payment status. The invoice prints the lines as they stand and the money
-- rows from the stored total, so on these orders the two do not add up.
--
-- One row per order with a return or an exchange whose stored total differs
-- from the value of its lines still sold: each line's quantity less the units
-- returned or exchanged away, at its price, the lines an exchange issued
-- included; net of the partner's commission when the order has one; after the
-- discount for an old WooCommerce order, whose total was stored that way.
-- booked_before_b78d364 says whether a return or an exchange on it predates
-- the fix; an order that shows up with false (booked while the fix was being
-- deployed, or something else) is worth a look too. Times are compared in
-- UTC, as Prisma stores them.
WITH still_sold AS (
  SELECT
    i."orderId",
    SUM(
      GREATEST(0, i.quantity
        - COALESCE((SELECT SUM(r.quantity) FROM "OrderReturn" r WHERE r."orderItemId" = i.id), 0)
        - COALESCE((SELECT SUM(x.quantity) FROM "OrderExchange" x WHERE x."originalItemId" = i.id), 0)
      ) * i.price
    ) AS gross
  FROM "OrderItem" i
  GROUP BY i."orderId"
),
touched AS (
  SELECT "orderId", MIN(at) AS first_at, SUM(returns) AS returns, SUM(exchanges) AS exchanges
  FROM (
    SELECT "orderId", "createdAt" AS at, 1 AS returns, 0 AS exchanges FROM "OrderReturn"
    UNION ALL
    SELECT "orderId", "createdAt", 0, 1 FROM "OrderExchange"
  ) moves
  GROUP BY "orderId"
),
orders AS (
  SELECT
    o.*,
    t.first_at,
    t.returns,
    t.exchanges,
    s.gross AS lines_still_sold,
    (SELECT cc."commissionRate" FROM "ConsignmentCommission" cc WHERE cc."orderId" = o.id ORDER BY cc."createdAt" LIMIT 1) AS commission_rate,
    (o."wooId" IS NOT NULL AND o."siteReference" IS NULL) AS old_woocommerce
  FROM "Order" o
  JOIN touched t ON t."orderId" = o.id
  LEFT JOIN still_sold s ON s."orderId" = o.id
)
SELECT
  o.number                                   AS order_number,
  o.id                                       AS order_id,
  o."createdAt"::date                        AS sold_on,
  c.name                                     AS customer,
  o.status,
  o."paymentStatus"                          AS payment_status,
  o."totalAmount"                            AS stored_total,
  o.lines_still_sold,
  o.commission_rate,
  CASE WHEN o.commission_rate > 0 THEN o.lines_still_sold * (1 - o.commission_rate / 100) END
                                             AS lines_still_sold_net_of_commission,
  o."totalAmount" - o.lines_still_sold       AS stored_minus_lines,
  o.discount,
  o."paidAmount"                             AS paid,
  o.old_woocommerce,
  o.returns,
  o.exchanges,
  o.first_at                                 AS first_return_or_exchange_at,
  EXISTS (SELECT 1 FROM "OrderReturn" r WHERE r."orderId" = o.id AND r."createdAt" < TIMESTAMP '2026-05-07 18:53:11')
    OR EXISTS (SELECT 1 FROM "OrderExchange" x WHERE x."orderId" = o.id AND x."createdAt" < TIMESTAMP '2026-05-07 18:53:11')
                                             AS booked_before_b78d364
FROM orders o
LEFT JOIN "Customer" c ON c.id = o."customerId"
WHERE ABS(o."totalAmount" - COALESCE(o.lines_still_sold, 0)) > 0.5
  AND NOT (COALESCE(o.commission_rate, 0) > 0
           AND ABS(o."totalAmount" - COALESCE(o.lines_still_sold, 0) * (1 - o.commission_rate / 100)) <= 0.5)
  AND NOT (o.old_woocommerce
           AND ABS(o."totalAmount" + o.discount - COALESCE(o.lines_still_sold, 0)) <= 0.5)
ORDER BY o.first_at, o.number;
