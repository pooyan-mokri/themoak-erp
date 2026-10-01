-- DATA FIX 2026-10-01: give foreign rows booked at rate 1 the rate of their date.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: the rows report-foreign-toman-equivalent.sql lists (a
-- dollar, euro or yuan transfer leg or balance correction stored with
-- rateSnapshot 1 and its Toman equivalent equal to the foreign amount; on the
-- real data, two USD ADJUSTMENT rows) get the rate in force on their date,
-- the latest ExchangeRate of their currency dated on or before the row:
-- "rateSnapshot" = that rate, "amountInToman" = amount × that rate. The
-- amount, and so every balance, stays. A row with no rate recorded on or
-- before its date is left as it is and counted in a NOTICE.
--
-- Idempotent: a fixed row no longer has rate 1, so a second run skips it.
DO $$
DECLARE
  n integer;
  total numeric;
  unpriced integer;
BEGIN
  WITH affected AS (
    SELECT t.id, t.amount, r."rateToToman" AS rate
    FROM "Transaction" t
    LEFT JOIN LATERAL (
      SELECT er."rateToToman"
      FROM "ExchangeRate" er
      WHERE er."currency" = t."currency" AND er."date" <= t."date"
      ORDER BY er."date" DESC, er."createdAt" DESC
      LIMIT 1
    ) r ON TRUE
    WHERE t."currency" <> 'TOMAN'
      AND t."rateSnapshot" = 1
      AND t."amountInToman" = t."amount"
      AND (
        t."type" IN ('TRANSFER', 'ADJUSTMENT')
        OR t."transferGroupId" IS NOT NULL
        OR t."category" IN ('انتقال وجه', 'انتقال داخلی')
      )
  ), changed AS (
    UPDATE "Transaction" t
    SET "rateSnapshot" = a.rate, "amountInToman" = a.amount * a.rate, "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM affected a
    WHERE t.id = a.id AND a.rate IS NOT NULL
    RETURNING t."amountInToman"
  )
  SELECT (SELECT count(*) FROM changed), (SELECT COALESCE(sum("amountInToman"), 0) FROM changed),
         (SELECT count(*) FROM affected WHERE rate IS NULL)
  INTO n, total, unpriced;
  RAISE NOTICE 'foreign-adjustment-rates: % rows now carry the rate of their date (Toman equivalent now %); % rows have no rate on or before their date and were left', n, total, unpriced;
END $$;
