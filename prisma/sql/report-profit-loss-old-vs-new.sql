-- READ-ONLY report. Not part of the build; changes nothing.
--
-- Profit and loss per month (Gregorian month, Tehran time), the old way and
-- the new way:
--   old: every INCOME row − every EXPENSE row (amountInToman);
--   new: revenue − cost of goods sold − operating expenses
--        (src/lib/profit-rows.ts), leaving out
--          * money that is not trading: capital in and out, profit paid out,
--            loans and their repayments, both legs of a currency exchange,
--            transfers, repaying an employee's out-of-pocket expense;
--          * stock bought: supplier payments ('Purchase Payment') and arrival
--            costs ('Purchase Arrival Cost'), which reach the P&L as COGS when
--            the goods are sold; and equipment bought ('خرید تجهیزات'), a fixed
--            asset that reaches it through depreciation;
--        and counting COGS rows as the cost line, and the interest part of a
--        loan repayment as revenue.
-- The last two columns are what moved: stock and equipment bought, and the rest.
WITH rows AS (
  SELECT
    to_char(t."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran', 'YYYY-MM') AS month,
    t."type",
    COALESCE(t."category", '') AS category,
    CASE WHEN t."amountInToman" <> 0 THEN t."amountInToman"
         WHEN t."currency" = 'TOMAN' THEN t."amount" ELSE 0 END AS toman,
    (t."exchangeGroupId" IS NOT NULL OR t."transferGroupId" IS NOT NULL OR COALESCE(t."category", '') IN (
      'Shareholder Deposit', 'Shareholder Withdrawal', 'Shareholder Profit Withdrawal',
      'قرض به کارمند', 'Loan Payment', 'Currency Exchange', 'انتقال وجه', 'انتقال داخلی',
      'تسویه بدهی کارمند', 'Employee Debt Payment'
    )) AS non_operating,
    COALESCE(t."category", '') IN ('Purchase Payment', 'Purchase Arrival Cost', 'خرید تجهیزات') AS stock_bought,
    COALESCE(lp."interest", 0) AS loan_interest,
    t."amountInToman" AS old_toman
  FROM "Transaction" t
  LEFT JOIN "LoanPayment" lp ON lp."transactionId" = t."id"
  WHERE t."type" IN ('INCOME', 'EXPENSE')
)
SELECT
  month,
  SUM(CASE WHEN "type" = 'INCOME' THEN old_toman ELSE 0 END)                                   AS old_income,
  SUM(CASE WHEN "type" = 'EXPENSE' THEN old_toman ELSE 0 END)                                  AS old_expense,
  SUM(CASE WHEN "type" = 'INCOME' THEN old_toman ELSE -old_toman END)                          AS old_net,
  SUM(CASE WHEN NOT non_operating AND NOT stock_bought AND "type" = 'INCOME' THEN toman ELSE 0 END) + SUM(loan_interest) AS new_revenue,
  SUM(CASE WHEN NOT non_operating AND NOT stock_bought AND "type" = 'EXPENSE' AND category = 'COGS' THEN toman ELSE 0 END) AS new_cogs,
  SUM(CASE WHEN NOT non_operating AND NOT stock_bought AND "type" = 'EXPENSE' AND category <> 'COGS' THEN toman ELSE 0 END) AS new_operating_expenses,
  SUM(CASE WHEN non_operating OR stock_bought THEN 0 WHEN "type" = 'INCOME' THEN toman ELSE -toman END) + SUM(loan_interest) AS new_net,
  SUM(CASE WHEN stock_bought THEN toman ELSE 0 END)                                            AS stock_bought_left_out,
  SUM(CASE WHEN non_operating THEN (CASE WHEN "type" = 'INCOME' THEN toman ELSE -toman END) ELSE 0 END) AS non_trading_net_left_out
FROM rows
GROUP BY month
ORDER BY month;
