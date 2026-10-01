-- DATA FIXES 2026-10-01, all of them, in one transaction. Not part of the build.
--
-- Pooyan's decisions of 2026-10-01 on the real data. Run with psql, once,
-- against the database to fix (each fix is idempotent, so a second run
-- changes nothing):
--
--   psql "<database url>" -v ON_ERROR_STOP=1 -f prisma/sql/datafix-2026-10-01-ALL.sql
--
-- then close purchase order #4 short with the order page's own code (it
-- needs the payment the SQL records on #4 first):
--
--   DATABASE_URL="<database url>" npx tsx scripts/datafix-2026-10-01-close-po4-short.ts
--
-- Each fix prints NOTICEs saying what it changed. A fix whose rows are not
-- as Pooyan described stops the run with an error, and the whole run rolls
-- back. Order: the fixes that touch no money first; the dates of the
-- wrongly dated orders before anything is booked at an order's date (COGS,
-- stock history); the partner loan before the rent deposits, so each takes
-- its own payments; the purchase-order payment before the COGS and stock
-- history.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
\ir datafix-2026-10-01-reset-tokens.sql
\ir datafix-2026-10-01-email-lowercase.sql
\ir datafix-2026-10-01-activity-role-names.sql
\ir datafix-2026-10-01-foreign-adjustment-rates.sql
\ir datafix-2026-10-01-jalali-dates.sql
\ir datafix-2026-10-01-partner-loan.sql
\ir datafix-2026-10-01-rent-deposits.sql
\ir datafix-2026-10-01-petty-cash.sql
\ir datafix-2026-10-01-partner-withdrawal.sql
\ir datafix-2026-10-01-po-paid-outside.sql
\ir datafix-2026-10-01-order-121-overpayment.sql
\ir datafix-2026-10-01-cogs-backfill.sql
\ir datafix-2026-10-01-movement-history.sql
COMMIT;
