-- READ-ONLY report: user emails and letter case. Sign-in now matches an email
-- in any letter case, and new or edited emails are stored lower-case. Nothing
-- here changes data; it is not part of the build.
--   psql "<database url>" -f prisma/sql/report-user-email-case.sql

-- 1. Accounts whose addresses differ only by letter case or spaces. Signing in
--    with a spelling that is not exactly one of them finds nobody, so a person
--    should decide which account is the real one (deactivate the other) or
--    give one of them another address.
SELECT lower(trim(email)) AS address, count(*) AS accounts,
       string_agg(email || ' (' || name || ', ' || role || ')', ' | ' ORDER BY "createdAt") AS users
FROM "User"
GROUP BY lower(trim(email))
HAVING count(*) > 1;

-- 2. Addresses not stored lower-case yet. They sign in fine; the next edit of
--    the user stores them lower-case.
SELECT id, name, email
FROM "User"
WHERE email <> lower(trim(email))
ORDER BY email;
