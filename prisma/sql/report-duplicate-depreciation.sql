-- READ-ONLY report. Not part of the build; changes nothing.
--
-- Depreciation is now booked once per asset per Jalali year (the row carries
-- the key depreciation-<assetId>-<year>). Before, every click posted another
-- year's worth. This lists every asset (by the row's description, «استهلاک
-- سالانه دارایی: <name>») and Jalali year with more than one depreciation
-- row, and the amount beyond the first. The Jalali year is taken as the
-- Gregorian year of (Tehran date − 79 days) − 621, exact except within a day
-- of Nowruz. Two assets with the same name share a description and show here
-- together.
WITH rows AS (
  SELECT
    t."id",
    t."description",
    t."date",
    t."amount",
    t."clientRequestId",
    EXTRACT(YEAR FROM ((t."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran') - INTERVAL '79 days'))::int - 621 AS jalali_year
  FROM "Transaction" t
  WHERE t."category" = 'Depreciation' AND t."type" = 'EXPENSE'
)
SELECT
  "description",
  jalali_year,
  COUNT(*)                                   AS rows,
  SUM("amount")                              AS booked,
  SUM("amount") - MIN("amount")              AS beyond_one_row,
  array_agg("id" ORDER BY "date")            AS transaction_ids,
  array_agg("date" ORDER BY "date")          AS dates
FROM rows
GROUP BY "description", jalali_year
HAVING COUNT(*) > 1
ORDER BY "description", jalali_year;
