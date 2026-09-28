-- READ-ONLY report: rows written before the platform fixes on test/platform
-- that the new checks would have refused. Nothing here changes data; it is
-- not part of the build. Run it by hand, e.g.
--   psql "<database url>" -f prisma/sql/report-platform-checks.sql

-- 1. Password-reset links still usable. Until now every link was printed to
--    the server log (Vercel logs), so whoever can read those logs can use
--    these. A person should decide whether to mark them used.
SELECT t.id, u.email, t."createdAt", t."expiresAt"
FROM "PasswordResetToken" t
JOIN "User" u ON u.id = t."userId"
WHERE t.used = false AND t."expiresAt" > now()
ORDER BY t."createdAt";

-- 2. The backup schedule as stored: a monthly day of 30 or 31 (skips the
--    Jalali months without it), a weekday outside 0-6, or a count of backups
--    to keep that is not a whole number from 1 to 365.
SELECT key, value
FROM "SystemSetting"
WHERE key = 'backup_settings'
  AND (
    (value::jsonb ->> 'frequency') NOT IN ('daily', 'weekly', 'monthly')
    OR ((value::jsonb ->> 'frequency') = 'monthly' AND coalesce(value::jsonb ->> 'dayOfMonth', '1') !~ '^([1-9]|1[0-9]|2[0-9])$')
    OR ((value::jsonb ->> 'frequency') = 'weekly' AND coalesce(value::jsonb ->> 'dayOfWeek', '0') !~ '^[0-6]$')
    OR coalesce(value::jsonb ->> 'keepBackups', '30') !~ '^[0-9]+$'
    OR coalesce(value::jsonb ->> 'keepBackups', '30')::numeric NOT BETWEEN 1 AND 365
  );

-- 3. The FTP receipt folder as stored: one the receipt viewer refuses
--    (relative, "..", a double slash, non-Latin letters) makes every receipt
--    upload fail. A trailing slash is now dropped when used.
SELECT value::jsonb ->> 'basePath' AS "basePath"
FROM "SystemSetting"
WHERE key = 'ftp_credentials'
  AND coalesce(value::jsonb ->> 'basePath', '') <> ''
  AND rtrim(value::jsonb ->> 'basePath', '/') !~ '^(/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$';

-- 4. Tasks with a status no board column shows (updateTaskStatus took any string).
SELECT t.id, t.title, t.status, p.name AS project
FROM "Task" t
JOIN "Project" p ON p.id = t."projectId"
WHERE t.status NOT IN ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- 5. Projects with a negative budget or an end date before the start.
SELECT id, name, budget, "startDate", "endDate"
FROM "Project"
WHERE budget < 0 OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" < "startDate");

-- 6. Product images whose file name is not a picture the upload now makes
--    (the extension used to come from the uploaded file's name).
SELECT id, sku, name, image
FROM "Product"
WHERE image LIKE '/uploads/products/%'
  AND image !~* '^/uploads/products/[0-9a-f-]{36}\.(jpe?g|png|webp)$';

-- 7. Expenses the AI assistant recorded with an amount below 1 toman (they
--    moved money INTO the account), or that left the account below zero.
SELECT a."createdAt", a.parameters, tr.id AS "transactionId", tr.amount, tr."amountInToman", acc.name AS account, acc.balance
FROM "AIAction" a
LEFT JOIN "Transaction" tr ON tr.id = a.result ->> 'transactionId'
LEFT JOIN "Account" acc ON acc.id = tr."accountId"
WHERE a.action = 'record_expense' AND a.success
  AND (
    jsonb_typeof(a.parameters -> 'amount') <> 'number'
    OR (a.parameters ->> 'amount')::numeric < 1
    OR acc.balance < 0
  );

-- 8. How many active admins there are: with none, nobody can manage users
--    (the last admin could demote themself until now; a deactivated admin
--    cannot sign in).
SELECT count(*) AS "activeAdmins" FROM "User" WHERE role = 'ADMIN' AND "isActive";
