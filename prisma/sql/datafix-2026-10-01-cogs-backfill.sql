-- DATA FIX 2026-10-01: book the cost of goods sold that past sales never booked.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: profit and loss is on a cost-of-goods-sold basis
-- (src/lib/profit-rows.ts), but sales made before each kind of sale booked
-- COGS (POS, consignment, website) have none or too little, so their months
-- overstate profit (report-sales-without-cogs.sql). Pooyan's decision: book
-- the missing COGS at each product's CURRENT cost price. Every uncancelled
-- order the report lists that has no COGS row at all (matched as the report
-- matches them: by orderId, or an old row naming «سفارش #N») gets one row of
--   Σ units still sold (sold − returned − exchanged) × costPrice now
-- when that is more than 1 toman, in exactly the shape src/lib/cogs.ts
-- writes a sale's COGS: a non-cash EXPENSE row in Toman, category 'COGS', on
-- the COGS account «بهای تمام‌شده کالای فروش‌رفته» (made, as ensureExpenseAccount
-- makes it, if missing), "<source> - سفارش #N" with the source the report
-- names (POS, consignment or website), linked to the order and its customer,
-- dated at the sale (the order's createdAt). No balance moves: the COGS
-- account's balance is never touched, as for every COGS row.
-- An order that booked some COGS is left even when the report lists it
-- (today's price × its units is more than what it booked): its COGS was
-- booked at the price of its day, and a later run of this file must not book
-- every later price change. On the real data that is consignment order #287:
-- it booked 56,905,800 toman, 248,000 less than today's prices give; it is a
-- documented exception of the report.
--
-- Idempotent per order: each row carries clientRequestId
-- 'cogs-backfill-<order id>' (unique), and an order with a COGS row is never
-- booked again.
DO $$
DECLARE
  cogs_account text;
  n integer;
  total numeric;
BEGIN
  SELECT id INTO cogs_account FROM "Account" WHERE name = 'بهای تمام‌شده کالای فروش‌رفته' ORDER BY "createdAt", id LIMIT 1;
  IF cogs_account IS NULL THEN
    cogs_account := 'cogs-account';
    INSERT INTO "Account" (id, name, type, currency, balance, "createdAt", "updatedAt")
    VALUES (cogs_account, 'بهای تمام‌شده کالای فروش‌رفته', 'EXPENSE', 'TOMAN', 0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));
  END IF;

  WITH sold AS (
    SELECT oi."orderId",
           SUM(GREATEST(0, oi.quantity - COALESCE(r.q, 0) - COALESCE(x.q, 0)) * p."costPrice") AS cost_now
    FROM "OrderItem" oi
    JOIN "Product" p ON p.id = oi."productId"
    LEFT JOIN (SELECT "orderItemId", SUM(quantity) AS q FROM "OrderReturn" GROUP BY 1) r ON r."orderItemId" = oi.id
    LEFT JOIN (SELECT "originalItemId", SUM(quantity) AS q FROM "OrderExchange" GROUP BY 1) x ON x."originalItemId" = oi.id
    GROUP BY oi."orderId"
  ), owed AS (
    SELECT o.id, o.number, o."customerId", o."createdAt",
           CASE
             WHEN o."siteReference" IS NOT NULL THEN 'بهای تمام‌شده کالای فروش سایت'
             WHEN EXISTS (SELECT 1 FROM "OrderItem" i JOIN "Warehouse" w ON w.id = i."warehouseId"
                          WHERE i."orderId" = o.id AND w."isVirtual") THEN 'بهای تمام‌شده کالای فروش امانی'
             ELSE 'بهای تمام‌شده کالای فروش صندوق'
           END AS source,
           s.cost_now
    FROM "Order" o
    JOIN sold s ON s."orderId" = o.id
    WHERE o.status <> 'CANCELLED'
      AND NOT EXISTS (
        SELECT 1 FROM "Transaction" t
        WHERE t.category = 'COGS'
          AND (t."orderId" = o.id
               OR (t."orderId" IS NULL AND t.description ~ ('سفارش #' || o.number || '($|[^0-9])')))
      )
  ), booked AS (
    INSERT INTO "Transaction" (id, type, currency, amount, "amountInToman", "rateSnapshot", "accountId", category,
                               description, "customerId", "orderId", date, "createdAt", "updatedAt", "clientRequestId")
    SELECT 'cogs-backfill-' || owed.id, 'EXPENSE', 'TOMAN', owed.cost_now, owed.cost_now, 1, cogs_account, 'COGS',
           owed.source || ' - سفارش #' || owed.number, owed."customerId", owed.id, owed."createdAt", (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'),
           'cogs-backfill-' || owed.id
    FROM owed
    WHERE owed.cost_now > 1
    ON CONFLICT DO NOTHING
    RETURNING amount
  )
  SELECT count(*), COALESCE(sum(amount), 0) INTO n, total FROM booked;
  RAISE NOTICE 'cogs-backfill: % orders, % toman of cost of goods sold booked at today''s cost prices', n, total;
END $$;
