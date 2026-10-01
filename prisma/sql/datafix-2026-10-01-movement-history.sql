-- DATA FIX 2026-10-01: rebuild the stock-movement history that past sales,
-- returns and exchanges never wrote. History only: Inventory is not touched.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes (InventoryMovement rows only, each dated at its event and
-- noted «بازسازی تاریخچه»):
--  1. SALE: every order line report-pos-sales-without-movements.sql lists
--     (no SALE movement of its order and product; website and WooCommerce
--     orders always wrote theirs) leaves its line's warehouse, dated at the
--     sale, or at the exchange for a line an exchange issued. Left out, and
--     counted in a NOTICE: a line with no warehouse recorded (nothing to take
--     it from), and the lines of a cancelled order whose cancel left nothing
--     on record (no «بازگشت از لغو سفارش» RETURN movement of the order, as
--     cancels before August 2026 left none): what that cancel put back is
--     unknown, and a sale alone would show the stock gone. A cancel on record
--     wrote what it put back, so that order's sales are rebuilt.
--  2. RETURN: the units report-returns-without-movements.sql counts as come
--     back without a movement (a return, or the goods given back in an
--     exchange), dated at the return or exchange. The warehouse they went
--     back to was chosen on the form and never stored; the line's own
--     warehouse is used. Where some units of an order and product already have
--     a RETURN movement, the missing ones are the earliest events'. Left out,
--     and counted: a line with no warehouse, an order cancelled with no cancel
--     on record (as in 1), and goods whose sale has no SALE movement even now
--     (a WooCommerce order, a line left out in 1): a return alone would show
--     stock that never left.
--  3. Gifts (report-gifts-without-movements.sql) are NOT rebuilt: a
--     marketing gift never stored the warehouse it came from, and a gift from
--     the product list stored neither product nor warehouse. They are counted
--     in a NOTICE for Pooyan to name the warehouses.
-- At the end a NOTICE gives how far each product's net movements in each
-- warehouse (in − out) still are from Inventory.quantity
-- (report-stock-movement-gaps.sql lists them); they are not forced to match.
--
-- Idempotent: every row has a fixed id per line or event, and a rebuilt line
-- or event no longer lacks its movement.
DO $$
DECLARE
  sales integer; sale_units integer;
  backs integer; back_units integer;
  no_wh integer; no_wh_units integer;
  cancelled integer; cancelled_units integer;
  back_no_wh integer; back_cancelled integer; back_unsold integer;
  gifts integer; gift_units integer; list_gifts integer;
  gap_pairs integer; gap_units integer;
BEGIN
  -- 1. Sales.
  IF to_regclass('pg_temp.history_lines') IS NOT NULL THEN
    DROP TABLE pg_temp.history_lines;
  END IF;
  CREATE TEMP TABLE history_lines ON COMMIT DROP AS
  SELECT oi.id AS line_id, oi."productId", oi."warehouseId", oi.quantity, o.id AS order_id, o.number, o.status,
         COALESCE(xi."createdAt", xn."createdAt") AS exchanged_at, o."createdAt" AS sold_at, w."isVirtual" AS virtual,
         -- The cancel on record: its restore (src/lib/restore-warehouse.ts), not a return's or an exchange's.
         EXISTS (SELECT 1 FROM "InventoryMovement" m
                 WHERE m.type = 'RETURN' AND m."referenceId" = o.id AND m.note LIKE 'بازگشت از لغو سفارش%') AS put_back
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  LEFT JOIN "Warehouse" w ON w.id = oi."warehouseId"
  LEFT JOIN "OrderExchange" xi ON xi.id = oi."exchangeId"
  LEFT JOIN LATERAL (
    SELECT x."createdAt" FROM "OrderExchange" x WHERE x."exchangeItemId" = oi.id ORDER BY x."createdAt" LIMIT 1
  ) xn ON TRUE
  WHERE o."siteReference" IS NULL
    AND o."wooId" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "InventoryMovement" m
      WHERE m.type = 'SALE' AND m."referenceId" = o.id AND m."productId" = oi."productId"
    );

  SELECT count(*), COALESCE(sum(quantity), 0) INTO no_wh, no_wh_units FROM history_lines WHERE "warehouseId" IS NULL;
  SELECT count(*), COALESCE(sum(quantity), 0) INTO cancelled, cancelled_units FROM history_lines
  WHERE "warehouseId" IS NOT NULL AND status = 'CANCELLED' AND NOT put_back;

  WITH added AS (
    INSERT INTO "InventoryMovement" (id, "productId", "fromWarehouseId", quantity, type, "referenceId", note, "createdAt")
    SELECT 'history-sale-' || line_id, "productId", "warehouseId", quantity, 'SALE', order_id,
           CASE
             WHEN exchanged_at IS NOT NULL THEN 'تعویض سفارش #' || number
             WHEN virtual THEN 'فروش امانی - سفارش #' || number
             ELSE 'فروش سفارش #' || number
           END || ' — بازسازی تاریخچه',
           COALESCE(exchanged_at, sold_at)
    FROM history_lines
    WHERE "warehouseId" IS NOT NULL AND (status <> 'CANCELLED' OR put_back)
    ON CONFLICT (id) DO NOTHING
    RETURNING quantity
  )
  SELECT count(*), COALESCE(sum(quantity), 0) INTO sales, sale_units FROM added;

  -- 2. Returns and the goods given back in exchanges.
  WITH back AS (
    SELECT 'return' AS kind, r.id AS event_id, r."orderId", oi."productId", oi."warehouseId", r.quantity, r."createdAt"
    FROM "OrderReturn" r JOIN "OrderItem" oi ON oi.id = r."orderItemId"
    UNION ALL
    SELECT 'exchange', x.id, x."orderId", oi."productId", oi."warehouseId", x.quantity, x."createdAt"
    FROM "OrderExchange" x JOIN "OrderItem" oi ON oi.id = x."originalItemId"
  ), moved AS (
    SELECT "referenceId" AS "orderId", "productId", SUM(quantity) AS units
    FROM "InventoryMovement" WHERE type = 'RETURN' GROUP BY 1, 2
  ), owed AS (
    SELECT b.*,
           SUM(b.quantity) OVER (PARTITION BY b."orderId", b."productId") - COALESCE(m.units, 0) AS missing,
           SUM(b.quantity) OVER (PARTITION BY b."orderId", b."productId" ORDER BY b."createdAt", b.event_id) - b.quantity AS before
    FROM back b
    LEFT JOIN moved m ON m."orderId" = b."orderId" AND m."productId" = b."productId"
  ), events AS (
    SELECT owed.*, LEAST(owed.quantity, GREATEST(0, owed.missing - owed.before)) AS units, o.number,
           o.status = 'CANCELLED' AND NOT EXISTS (
             SELECT 1 FROM "InventoryMovement" m
             WHERE m.type = 'RETURN' AND m."referenceId" = o.id AND m.note LIKE 'بازگشت از لغو سفارش%'
           ) AS cancel_unknown,
           EXISTS (
             SELECT 1 FROM "InventoryMovement" m
             WHERE m.type = 'SALE' AND m."referenceId" = o.id AND m."productId" = owed."productId"
           ) AS sale_on_record
    FROM owed JOIN "Order" o ON o.id = owed."orderId"
  ), counted AS (
    SELECT count(*) FILTER (WHERE "warehouseId" IS NULL) AS events_without_warehouse,
           count(*) FILTER (WHERE "warehouseId" IS NOT NULL AND cancel_unknown) AS events_of_unknown_cancels,
           count(*) FILTER (WHERE "warehouseId" IS NOT NULL AND NOT cancel_unknown AND NOT sale_on_record) AS events_of_unsold
    FROM events WHERE units > 0
  ), added AS (
    INSERT INTO "InventoryMovement" (id, "productId", "toWarehouseId", quantity, type, "referenceId", note, "createdAt")
    SELECT 'history-' || kind || '-' || event_id, "productId", "warehouseId", units, 'RETURN', "orderId",
           CASE kind WHEN 'return' THEN 'مرجوعی سفارش #' ELSE 'تعویض سفارش #' END || number || ' — بازسازی تاریخچه',
           "createdAt"
    FROM events
    WHERE units > 0 AND "warehouseId" IS NOT NULL AND NOT cancel_unknown AND sale_on_record
    ON CONFLICT (id) DO NOTHING
    RETURNING quantity
  )
  SELECT (SELECT count(*) FROM added), (SELECT COALESCE(sum(quantity), 0) FROM added),
         (SELECT events_without_warehouse FROM counted), (SELECT events_of_unknown_cancels FROM counted),
         (SELECT events_of_unsold FROM counted)
  INTO backs, back_units, back_no_wh, back_cancelled, back_unsold;

  -- 3. Gifts: counted only.
  SELECT count(*), COALESCE(sum(quantity), 0) INTO gifts, gift_units
  FROM "MarketingGift" g WHERE NOT EXISTS (SELECT 1 FROM "InventoryMovement" m WHERE m."referenceId" = g.id);
  SELECT count(*) INTO list_gifts
  FROM "Transaction" t
  WHERE t.category = 'Marketing/Gift' AND NOT EXISTS (SELECT 1 FROM "InventoryMovement" m WHERE m."referenceId" = t.id);

  -- How far the history still is from the stock, per product and warehouse.
  WITH net AS (
    SELECT "productId", warehouse, SUM(units) AS units FROM (
      SELECT "productId", "toWarehouseId" AS warehouse, quantity AS units FROM "InventoryMovement" WHERE "toWarehouseId" IS NOT NULL
      UNION ALL
      SELECT "productId", "fromWarehouseId", -quantity FROM "InventoryMovement" WHERE "fromWarehouseId" IS NOT NULL
    ) moves GROUP BY 1, 2
  ), gaps AS (
    SELECT COALESCE(i.quantity, 0) - COALESCE(n.units, 0) AS gap
    FROM "Inventory" i
    FULL JOIN net n ON n."productId" = i."productId" AND n.warehouse = i."warehouseId"
  )
  SELECT count(*) FILTER (WHERE gap <> 0), COALESCE(sum(abs(gap)), 0) INTO gap_pairs, gap_units FROM gaps;

  RAISE NOTICE 'movement-history: % SALE movements rebuilt (% units)', sales, sale_units;
  RAISE NOTICE 'movement-history: % RETURN movements rebuilt (% units)', backs, back_units;
  RAISE NOTICE 'movement-history: left out: % sold lines with no warehouse (% units), % lines of cancelled orders with no cancel on record (% units)',
    no_wh, no_wh_units, cancelled, cancelled_units;
  RAISE NOTICE 'movement-history: left out: % returns/exchanges with no warehouse, % of cancelled orders with no cancel on record, % whose sale has no movement',
    back_no_wh, back_cancelled, back_unsold;
  RAISE NOTICE 'movement-history: not rebuilt, no warehouse on record: % marketing gifts (% units), % gifts from the product list',
    gifts, gift_units, list_gifts;
  RAISE NOTICE 'movement-history: % product/warehouse pairs still differ from Inventory, by % units in all (report-stock-movement-gaps.sql)',
    gap_pairs, gap_units;
END $$;
