-- DATA FIX 2026-10-01: expire every outstanding password-reset link.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: until the platform fixes every reset link was printed to
-- the server log, so whoever can read those logs could use one
-- (report-platform-checks.sql, part 1). Each token that is unused and not
-- yet expired gets "expiresAt" = now (in UTC, as the app stores times), so
-- the reset page refuses it; "used"
-- stays false, so the history still shows it was never used. A user who
-- needs one asks for a new link.
--
-- Idempotent: a second run finds no unexpired token.
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE "PasswordResetToken" SET "expiresAt" = (now() AT TIME ZONE 'UTC')
  WHERE used = false AND "expiresAt" > (now() AT TIME ZONE 'UTC');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'reset-tokens: % outstanding links expired', n;
END $$;
