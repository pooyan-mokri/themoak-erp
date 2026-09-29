-- READ-ONLY report. Not part of the build; changes nothing.
--
-- A shareholders' profit period used to end at the Tehran midnight that
-- starts its last day (the date picker's value), so the income and expense of
-- that last day fell in no period: the next period had to start the day
-- after. New periods hold the whole last day.
--
-- For each period already calculated: the trading income and expense dated on
-- its last day after that midnight, which no period counted, and whether a
-- later period covers them (it cannot have: it starts the day after).
SELECT
  p."periodStart",
  p."periodEnd",
  SUM(p."amount") AS distributed,
  (SELECT COALESCE(SUM(CASE WHEN t."type" = 'INCOME' THEN 1 ELSE -1 END * t."amountInToman"), 0)
     FROM "Transaction" t
    WHERE t."type" IN ('INCOME', 'EXPENSE')
      AND t."date" > p."periodEnd"
      AND t."date" < p."periodEnd" + INTERVAL '1 day'
      AND t."exchangeGroupId" IS NULL AND t."transferGroupId" IS NULL
      AND COALESCE(t."category", '') NOT IN (
        'Shareholder Deposit', 'Shareholder Withdrawal', 'Shareholder Profit Withdrawal',
        'قرض به کارمند', 'Loan Payment', 'Currency Exchange', 'انتقال وجه', 'انتقال داخلی',
        'تسویه بدهی کارمند', 'Employee Debt Payment'
      )) AS last_day_net_left_out,
  EXISTS (
    SELECT 1 FROM "ShareholderProfit" q
     WHERE q."periodStart" <= p."periodEnd" + INTERVAL '1 day' AND q."periodStart" > p."periodEnd"
  ) AS next_period_starts_that_day
FROM "ShareholderProfit" p
GROUP BY p."periodStart", p."periodEnd"
ORDER BY p."periodStart";
