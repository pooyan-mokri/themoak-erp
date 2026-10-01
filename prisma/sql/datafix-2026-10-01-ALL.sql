-- DATA FIXES 2026-10-01, all of them, in one transaction. Not part of the build.
--
-- Pooyan's decisions of 2026-10-01 on the real data. Run with psql, once,
-- against the database to fix (each fix is idempotent, so a second run
-- changes nothing):
--
--   psql "<database url>" -v ON_ERROR_STOP=1 -f prisma/sql/datafix-2026-10-01-ALL.sql
--
-- Each fix prints NOTICEs saying what it changed. Any error rolls the whole
-- run back. Order: the account-free fixes first, then money, then stock
-- history (no fix reads what a later one writes, except that the petty-cash
-- and COGS fixes make the accounts they need).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
\ir datafix-2026-10-01-reset-tokens.sql
\ir datafix-2026-10-01-email-lowercase.sql
\ir datafix-2026-10-01-foreign-adjustment-rates.sql
\ir datafix-2026-10-01-rent-deposits.sql
\ir datafix-2026-10-01-petty-cash.sql
\ir datafix-2026-10-01-po-paid-outside.sql
\ir datafix-2026-10-01-cogs-backfill.sql
\ir datafix-2026-10-01-movement-history.sql
COMMIT;
