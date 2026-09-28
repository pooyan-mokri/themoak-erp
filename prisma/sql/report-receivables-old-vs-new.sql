-- READ-ONLY report. Not part of the build; changes nothing.
--
-- What customers owe is now one rule (src/lib/order-balance.ts, summed by
-- customerReceivables in src/lib/money-totals.ts): over every uncancelled
-- order of a customer, whatever its payment status, max(0, net − paid), where
-- net = total − discount (an old WooCommerce order stores its total after the
-- discount: net = total). Before:
--   * the dashboard's «مطالبات» took total − paid over UNPAID and PARTIAL
--     orders: the discount was never taken off;
--   * the aging report took the discount off but skipped an order whose
--     payment status said PAID;
--   * the balance sheet counted only unpaid invoices.
--
-- One row per order where the dashboard's old figure and the new one differ,
-- then the three totals. A PAID order that still owes (its status stale) is
-- worth a look: record the payment or correct the order.
WITH o AS (
  SELECT ord.number, c.name AS customer, ord."paymentStatus",
         ord."totalAmount" AS total, ord.discount, ord."paidAmount" AS paid,
         CASE WHEN ord."wooId" IS NOT NULL AND ord."siteReference" IS NULL
              THEN GREATEST(0, ord."totalAmount")
              ELSE GREATEST(0, ord."totalAmount" - ord.discount) END AS net
  FROM "Order" ord
  JOIN "Customer" c ON c.id = ord."customerId"
  WHERE ord.status <> 'CANCELLED'
), f AS (
  SELECT *,
         CASE WHEN "paymentStatus" IN ('UNPAID', 'PARTIAL') THEN GREATEST(0, total - paid) ELSE 0 END AS old_dashboard,
         CASE WHEN net - paid > 0.5 THEN net - paid ELSE 0 END AS owed_now
  FROM o
)
SELECT number, customer, "paymentStatus", ROUND(total) AS total, ROUND(discount) AS discount, ROUND(paid) AS paid,
       ROUND(old_dashboard) AS old_dashboard, ROUND(owed_now) AS owed_now
FROM f
WHERE ABS(old_dashboard - owed_now) > 0.5
ORDER BY ABS(old_dashboard - owed_now) DESC;

SELECT
  (SELECT ROUND(COALESCE(SUM(GREATEST(0, "totalAmount" - "paidAmount")), 0)) FROM "Order"
    WHERE "customerId" IS NOT NULL AND status <> 'CANCELLED' AND "paymentStatus" IN ('UNPAID', 'PARTIAL')) AS old_dashboard_total,
  (SELECT ROUND(COALESCE(SUM(total - "paidAmount"), 0)) FROM "Invoice" WHERE status IN ('UNPAID', 'PARTIAL', 'OVERDUE')) AS old_balance_sheet_total,
  (SELECT ROUND(COALESCE(SUM(CASE WHEN net - paid > 0.5 THEN net - paid ELSE 0 END), 0)) FROM (
     SELECT CASE WHEN "wooId" IS NOT NULL AND "siteReference" IS NULL THEN GREATEST(0, "totalAmount")
                 ELSE GREATEST(0, "totalAmount" - discount) END AS net,
            "paidAmount" AS paid
     FROM "Order" WHERE "customerId" IS NOT NULL AND status <> 'CANCELLED') x) AS owed_now_total;
