-- DATA FIX 2026-10-01: store user emails trimmed and lower-case.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: sign-in matches an email in any letter case and the user
-- forms now store it as normalizeEmail does (src/lib/user-email.ts: trim,
-- lower-case); older addresses may still carry capitals or spaces
-- (report-user-email-case.sql, part 2). Each such address is stored
-- normalized, unless another user's address normalizes to the same one: such
-- a collision is left as it is and named by user id in a NOTICE, for a person
-- to decide which account is the real one (part 1 of that report).
--
-- Idempotent: a second run finds nothing left to normalize but the collisions.
DO $$
DECLARE
  n integer;
  r record;
BEGIN
  UPDATE "User" u SET email = lower(trim(u.email)), "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE u.email <> lower(trim(u.email))
    AND NOT EXISTS (
      SELECT 1 FROM "User" o WHERE o.id <> u.id AND lower(trim(o.email)) = lower(trim(u.email))
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'email-lowercase: % emails stored lower-case', n;
  FOR r IN
    SELECT string_agg(id, ', ' ORDER BY "createdAt", id) AS ids
    FROM "User"
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  LOOP
    RAISE NOTICE 'email-lowercase: collision left as it is, users %', r.ids;
  END LOOP;
END $$;
