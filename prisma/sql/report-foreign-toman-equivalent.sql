-- READ-ONLY report. Not part of the build; changes nothing.
--
-- A transfer between two dollar (or euro, yuan) accounts was booked with its
-- Toman equivalent equal to the foreign amount, at rate 1: a 100-dollar
-- transfer shows «(۱۰۰ تومان)» in the journal and 100 in the Excel export's
-- Toman column. From now on the legs keep the amount at the latest recorded
-- rate. The balances were never affected; only amountInToman/rateSnapshot are.
-- The same happened to the opening-balance, correction and
-- baseline rows (ADJUSTMENT) of a foreign account; they are listed too.
--
-- One row per affected transaction, with the rate recorded on or before its
-- date (null when none was) and the equivalent at that rate.
SELECT
  t."id",
  t."date",
  a."name"                         AS account,
  t."currency",
  t."type",
  t."category",
  t."description",
  t."amount",
  t."amountInToman"                AS stored_toman,
  t."rateSnapshot"                 AS stored_rate,
  r."rateToToman"                  AS rate_at_date,
  t."amount" * r."rateToToman"     AS toman_at_that_rate,
  t."transferGroupId"
FROM "Transaction" t
LEFT JOIN "Account" a ON a."id" = t."accountId"
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
ORDER BY t."date", t."id";
