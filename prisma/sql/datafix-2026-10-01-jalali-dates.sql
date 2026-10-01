-- DATA FIX 2026-10-01: orders dated in the year 1404 AD, a Jalali date stored as Gregorian.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: the old WooCommerce sync stored the Persian store's dates
-- as they were, so 16 orders (#79–#88, #298–#303 on the real data) and their
-- money rows are dated in 1404–1405 AD: «1404-09-28 18:22:36» is 28 Azar 1404.
-- Every order whose createdAt is before the year 1700, and every row tied to
-- such an order and dated before 1700 (its money rows: checkout, payments,
-- COGS, by orderId or Order.transactionId; its stock movements, by
-- referenceId; its commissions, returns, exchanges, customer credits and
-- website refunds), gets its stored date read as a Jalali date and converted
-- to the Gregorian one, keeping the stored time of day:
--   1404-09-28 18:22:36 → 2025-12-19 18:22:36.
-- Each converted date must fall from 2025-03-21 (1 Farvardin 1404) to now;
-- otherwise nothing is changed and the run stops (RAISE EXCEPTION). A Jalali
-- day the Gregorian calendar lacks (30 Ordibehesht, 31 Tir, 31 Shahrivar…)
-- was rolled over by the sync into the next month's first days, so a stored
-- 1–3 March, 1 May or 1 July cannot be told apart: such a row stops the run
-- too (the real data has none). The
-- conversion is jalaali-js's (the 33-year break table), as the app's
-- Jalali dates are. The website refuses such a date now (src/lib/entry-date.ts).
--
-- Idempotent: a converted date is after 1700, so a second run finds nothing.
DO $$
DECLARE
  converted integer := 0;
  target record;
  n integer;
  orders text;
BEGIN
  -- jalaali-js's conversion of a Jalali date to the Gregorian day (src/lib/date-utils.ts uses the same calendar).
  CREATE OR REPLACE FUNCTION pg_temp.jalali_to_gregorian(jy integer, jm integer, jd integer) RETURNS date
  LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE
    breaks integer[] := ARRAY[-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    gy integer := jy + 621;
    leap_j integer := -14;
    jp integer := breaks[1];
    jm_break integer;
    jump integer := 0;
    n integer;
    leap_g integer;
    march integer;
    i integer;
  BEGIN
    IF jy < breaks[1] OR jy >= breaks[array_length(breaks, 1)] OR jm NOT BETWEEN 1 AND 12 OR jd NOT BETWEEN 1 AND 31
       OR (jm > 6 AND jd > 30) THEN
      RAISE EXCEPTION 'not a Jalali date: %/%/%', jy, jm, jd;
    END IF;
    FOR i IN 2 .. array_length(breaks, 1) LOOP
      jm_break := breaks[i];
      jump := jm_break - jp;
      EXIT WHEN jy < jm_break;
      leap_j := leap_j + (jump / 33) * 8 + ((jump % 33) / 4);
      jp := jm_break;
    END LOOP;
    n := jy - jp;
    leap_j := leap_j + (n / 33) * 8 + (((n % 33) + 3) / 4);
    IF jump % 33 = 4 AND jump - n = 4 THEN
      leap_j := leap_j + 1;
    END IF;
    leap_g := (gy / 4) - (((gy / 100) + 1) * 3) / 4 - 150;
    march := 20 + leap_j - leap_g;
    RETURN make_date(gy, 3, march) + ((jm - 1) * 31 - (jm / 7) * (jm - 7) + jd - 1);
  END $fn$;

  IF to_regclass('pg_temp.jalali_rows') IS NOT NULL THEN DROP TABLE pg_temp.jalali_rows; END IF;
  IF to_regclass('pg_temp.jalali_orders') IS NOT NULL THEN DROP TABLE pg_temp.jalali_orders; END IF;
  -- The orders, and every row tied to one, stored before 1700.
  CREATE TEMP TABLE jalali_rows (tbl text, col text, id text, stored timestamp, fixed timestamp) ON COMMIT DROP;
  CREATE TEMP TABLE jalali_orders ON COMMIT DROP AS
    SELECT id, number, "transactionId" FROM "Order" WHERE "createdAt" < '1700-01-01';
  INSERT INTO jalali_rows (tbl, col, id, stored)
    SELECT 'Order', 'createdAt', o.id, o."createdAt" FROM "Order" o JOIN jalali_orders j ON j.id = o.id
    UNION ALL
    SELECT 'Transaction', 'date', t.id, t.date FROM "Transaction" t
      WHERE t.date < '1700-01-01' AND (t."orderId" IN (SELECT id FROM jalali_orders) OR t.id IN (SELECT "transactionId" FROM jalali_orders))
    UNION ALL
    SELECT 'InventoryMovement', 'createdAt', m.id, m."createdAt" FROM "InventoryMovement" m
      WHERE m."createdAt" < '1700-01-01' AND m."referenceId" IN (SELECT id FROM jalali_orders)
    UNION ALL
    SELECT 'ConsignmentCommission', 'createdAt', c.id, c."createdAt" FROM "ConsignmentCommission" c
      WHERE c."createdAt" < '1700-01-01' AND c."orderId" IN (SELECT id FROM jalali_orders)
    UNION ALL
    SELECT 'OrderReturn', 'createdAt', r.id, r."createdAt" FROM "OrderReturn" r
      WHERE r."createdAt" < '1700-01-01' AND r."orderId" IN (SELECT id FROM jalali_orders)
    UNION ALL
    SELECT 'OrderExchange', 'createdAt', x.id, x."createdAt" FROM "OrderExchange" x
      WHERE x."createdAt" < '1700-01-01' AND x."orderId" IN (SELECT id FROM jalali_orders)
    UNION ALL
    SELECT 'CustomerCredit', 'createdAt', c.id, c."createdAt" FROM "CustomerCredit" c
      WHERE c."createdAt" < '1700-01-01' AND c."orderId" IN (SELECT id FROM jalali_orders)
    UNION ALL
    SELECT 'SiteRefund', 'at', s.id, s.at FROM "SiteRefund" s
      WHERE s.at < '1700-01-01' AND s."orderId" IN (SELECT id FROM jalali_orders);

  SELECT count(*) INTO n FROM jalali_rows
  WHERE (extract(month FROM stored) = 3 AND extract(day FROM stored) <= 3)
     OR (extract(month FROM stored) IN (5, 7) AND extract(day FROM stored) = 1);
  IF n > 0 THEN
    RAISE EXCEPTION 'jalali-dates: % dates may be a Jalali day rolled over by the sync (1-3 March, 1 May, 1 July); nothing changed', n;
  END IF;

  -- The stored date's own year, month and day are the Jalali ones; the time of day stays.
  UPDATE jalali_rows SET fixed =
    pg_temp.jalali_to_gregorian(extract(year FROM stored)::int, extract(month FROM stored)::int, extract(day FROM stored)::int)
    + (stored - date_trunc('day', stored));

  SELECT count(*) INTO n FROM jalali_rows
  WHERE fixed < '2025-03-21' OR fixed > (now() AT TIME ZONE 'UTC');
  IF n > 0 THEN
    RAISE EXCEPTION 'jalali-dates: % dates would fall outside 2025-03-21 .. now; nothing changed', n;
  END IF;

  FOR target IN SELECT tbl, col FROM jalali_rows GROUP BY tbl, col ORDER BY tbl LOOP
    EXECUTE format('UPDATE %I x SET %I = r.fixed FROM jalali_rows r WHERE r.tbl = %L AND r.col = %L AND r.id = x.id',
                   target.tbl, target.col, target.tbl, target.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    converted := converted + n;
    RAISE NOTICE 'jalali-dates: % % rows (%) converted', n, target.tbl, target.col;
  END LOOP;
  SELECT string_agg('#' || number, ' ' ORDER BY number) INTO orders FROM jalali_orders;
  RAISE NOTICE 'jalali-dates: % dates converted, orders: %', converted, COALESCE(orders, 'none');
END $$;
