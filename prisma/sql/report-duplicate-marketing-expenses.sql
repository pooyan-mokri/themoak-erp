-- READ-ONLY report. Not part of the build; changes nothing.
--
-- getAccounts (the accounts page and every page that lists accounts) created
-- the «Marketing Expenses» account when it found none, with a plain create;
-- two pages opened at the same moment on a database without it each made one
-- (8 at once made 3 in a test). From now on it is created once under the fixed
-- id 'marketing-expenses'. More than one row below means copies exist: gifts
-- may be booked on either, and the gift form preselects whichever it finds first.
SELECT
  a."id",
  a."createdAt",
  a."type",
  a."currency",
  a."balance",
  COUNT(t."id")          AS transactions,
  COALESCE(SUM(t."amountInToman"), 0) AS toman_booked,
  (SELECT COUNT(*) FROM "MarketingGift" g WHERE g."accountId" = a."id") AS gifts
FROM "Account" a
LEFT JOIN "Transaction" t ON t."accountId" = a."id"
WHERE a."name" = 'Marketing Expenses'
GROUP BY a."id"
ORDER BY a."createdAt";
