-- READ-ONLY report. Not part of the build; changes nothing.
--
-- Profit and loss (src/actions/reports.ts) and the shareholders' profit
-- (src/actions/shareholder-profit.ts) now leave out money that is not trading
-- (src/lib/profit-rows.ts): capital deposits and withdrawals, profit paid out,
-- loans and their repayments, both legs of a currency exchange, transfers
-- between our own accounts, and repaying an employee's out-of-pocket expense.
-- Before, every INCOME and EXPENSE row counted.

-- 1. What used to count, by Gregorian month in Tehran time and by kind: income and expense
--    in Toman that the old P&L added and the new one does not.
SELECT
  to_char(t."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran', 'YYYY-MM') AS month_tehran,
  COALESCE(t."category", '(none)')                                          AS category,
  t."type",
  COUNT(*)                                                                  AS rows,
  SUM(t."amountInToman")                                                    AS toman
FROM "Transaction" t
WHERE t."type" IN ('INCOME', 'EXPENSE')
  AND (
    t."exchangeGroupId" IS NOT NULL
    OR t."transferGroupId" IS NOT NULL
    OR t."category" IN (
      'Shareholder Deposit', 'Shareholder Withdrawal', 'Shareholder Profit Withdrawal',
      'قرض به کارمند', 'Loan Payment', 'Currency Exchange', 'انتقال وجه', 'انتقال داخلی',
      'تسویه بدهی کارمند', 'Employee Debt Payment'
    )
  )
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 2. Shareholders' profit already calculated. Its amount was worked out with
--    the old rule (and, by SQL NULL rules, without rows that have no category).
--    For each period: the net profit by the old rule and by the new one; a
--    period where they differ was distributed on a different figure.
WITH periods AS (
  SELECT "periodStart", "periodEnd", SUM("amount") AS distributed, SUM("withdrawn") AS withdrawn
  FROM "ShareholderProfit"
  GROUP BY "periodStart", "periodEnd"
),
rows AS (
  SELECT t.*,
    (t."exchangeGroupId" IS NOT NULL OR t."transferGroupId" IS NOT NULL OR t."type" = 'TRANSFER' OR t."category" IN (
      'Shareholder Deposit', 'Shareholder Withdrawal', 'Shareholder Profit Withdrawal',
      'قرض به کارمند', 'Loan Payment', 'Currency Exchange', 'انتقال وجه', 'انتقال داخلی',
      'تسویه بدهی کارمند', 'Employee Debt Payment'
    )) AS non_operating
  FROM "Transaction" t
  WHERE t."type" IN ('INCOME', 'EXPENSE')
)
SELECT
  p."periodStart",
  p."periodEnd",
  p.distributed,
  p.withdrawn,
  SUM(CASE WHEN r."category" NOT IN ('Shareholder Deposit', 'Shareholder Profit Withdrawal')
           THEN (CASE WHEN r."type" = 'INCOME' THEN 1 ELSE -1 END) * COALESCE(NULLIF(r."amountInToman", 0), r."amount") END) AS net_old_rule,
  SUM(CASE WHEN NOT r.non_operating
           THEN (CASE WHEN r."type" = 'INCOME' THEN 1 ELSE -1 END) * COALESCE(NULLIF(r."amountInToman", 0), r."amount") END) AS net_new_rule
FROM periods p
LEFT JOIN rows r ON r."date" >= p."periodStart" AND r."date" <= p."periodEnd"
GROUP BY p."periodStart", p."periodEnd", p.distributed, p.withdrawn
ORDER BY p."periodStart";
