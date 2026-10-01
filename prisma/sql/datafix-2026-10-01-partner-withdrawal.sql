-- DATA FIX 2026-10-01: the 20M «تنخواه BOOOM» was a partner's withdrawal, not TheMoak's business.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: the EXPENSE row "Other - تنخواه BOOOM" (20,000,000 on
-- 2026-08-31 14:00:05.34 UTC) becomes «برداشت شریک», a partner's withdrawal:
-- capital paid out, not an expense (src/lib/profit-rows.ts). The ERP's
-- capital withdrawal ('Shareholder Withdrawal', src/actions/shareholder.ts)
-- needs a shareholder, and Pooyan has not said which, so it is booked
-- without one; its account's balance stays (the money did leave it).
-- On a copy where the first version of the petty-cash fix had already made
-- it a transfer to «تنخواه showroom», the transfer is undone first: its
-- incoming leg is removed and its account's balance taken down by the 20M.
-- Unless exactly this one row is found, in one of those states, nothing
-- changes and the run stops.
--
-- Idempotent: a second run finds it booked and changes nothing.
DO $$
DECLARE
  r record;
  n integer;
  into_leg record;
BEGIN
  SELECT count(*) INTO n
  FROM "Transaction"
  WHERE amount = 20000000 AND date = '2026-08-31 14:00:05.34'
    AND ((type = 'EXPENSE' AND description = 'Other - تنخواه BOOOM' AND category IN ('Other', 'برداشت شریک'))
      OR (type = 'TRANSFER' AND description = '[خروج] تنخواه BOOOM'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'partner-withdrawal: expected one 20M «تنخواه BOOOM» row of 2026-08-31, found %; nothing changed', n;
  END IF;

  SELECT * INTO r
  FROM "Transaction"
  WHERE amount = 20000000 AND date = '2026-08-31 14:00:05.34'
    AND ((type = 'EXPENSE' AND description = 'Other - تنخواه BOOOM' AND category IN ('Other', 'برداشت شریک'))
      OR (type = 'TRANSFER' AND description = '[خروج] تنخواه BOOOM'))
  FOR UPDATE;

  IF r.type = 'EXPENSE' AND r.category = 'برداشت شریک' THEN
    RAISE NOTICE 'partner-withdrawal: already booked as «برداشت شریک»';
    RETURN;
  END IF;

  IF r.type = 'TRANSFER' THEN
    SELECT * INTO into_leg FROM "Transaction" WHERE "transferGroupId" = r."transferGroupId" AND id <> r.id FOR UPDATE;
    IF into_leg.id IS NOT NULL THEN
      UPDATE "Account" SET balance = balance - into_leg.amount, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = into_leg."accountId";
      DELETE FROM "Transaction" WHERE id = into_leg.id;
      RAISE NOTICE 'partner-withdrawal: the earlier transfer''s incoming leg on % removed, its balance down by %', into_leg."accountId", into_leg.amount;
    END IF;
  END IF;

  UPDATE "Transaction"
  SET type = 'EXPENSE', category = 'برداشت شریک', description = 'Other - تنخواه BOOOM',
      "transferGroupId" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE id = r.id;
  RAISE NOTICE 'partner-withdrawal: 20,000,000 «تنخواه BOOOM» is now «برداشت شریک»; which shareholder is still to name';
END $$;
