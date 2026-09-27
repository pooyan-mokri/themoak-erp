-- READ-ONLY REPORT. Not run by the build; it changes nothing.
--
-- Orders that are not cancelled and on which the customer has paid more than
-- the order's net: money the ERP still keeps on the order instead of in the
-- customer's credit account (CustomerCredit, since fix/invoice-returns). Run
-- it by hand against production, e.g.
--   psql "$DATABASE_URL" -f prisma/sql/report-legacy-overpaid-orders.sql
-- and decide order by order before moving anything to CustomerCredit.
--
-- The net is what the app shows (src/lib/order-balance.ts): total less
-- discount, never negative, except an old WooCommerce order (wooId set, no
-- siteReference), whose total was stored already after its discount.
--
-- likely_cause:
--   return / exchange before b78d364  a return or an exchange booked before
--       the order totals followed them (2026-05-07); see
--       report-legacy-return-totals.sql
--   cheaper exchange kept on the order  an exchange lowered the bill and the
--       difference was not paid back (priceDifference < 0, no money row)
--   other  look at the order's payments
WITH orders AS (
  SELECT
    o.*,
    (o."wooId" IS NOT NULL AND o."siteReference" IS NULL) AS old_woocommerce,
    CASE
      WHEN o."wooId" IS NOT NULL AND o."siteReference" IS NULL THEN GREATEST(0, o."totalAmount")
      ELSE GREATEST(0, o."totalAmount" - o.discount)
    END AS net
  FROM "Order" o
  WHERE o.status <> 'CANCELLED'
)
SELECT
  o.number                                   AS order_number,
  o.id                                       AS order_id,
  o."createdAt"::date                        AS sold_on,
  c.name                                     AS customer,
  o."customerId"                             AS customer_id,
  o.status,
  o."paymentStatus"                          AS payment_status,
  o."totalAmount"                            AS total_amount,
  o.discount,
  o.net,
  o."paidAmount"                             AS paid,
  o."paidAmount" - o.net                     AS overpaid,
  o.old_woocommerce,
  (SELECT count(*) FROM "OrderReturn" r WHERE r."orderId" = o.id)   AS returns,
  (SELECT count(*) FROM "OrderExchange" x WHERE x."orderId" = o.id) AS exchanges,
  CASE
    WHEN EXISTS (SELECT 1 FROM "OrderReturn" r WHERE r."orderId" = o.id AND r."createdAt" < TIMESTAMP '2026-05-07 18:53:11')
      OR EXISTS (SELECT 1 FROM "OrderExchange" x WHERE x."orderId" = o.id AND x."createdAt" < TIMESTAMP '2026-05-07 18:53:11')
      THEN 'return / exchange before b78d364'
    WHEN EXISTS (
      SELECT 1 FROM "OrderExchange" x
      WHERE x."orderId" = o.id AND x."priceDifference" < 0 AND x."transactionId" IS NULL
    )
      THEN 'cheaper exchange kept on the order'
    ELSE 'other'
  END                                        AS likely_cause
FROM orders o
LEFT JOIN "Customer" c ON c.id = o."customerId"
WHERE o."paidAmount" > o.net + 0.5
ORDER BY overpaid DESC, o.number;
