-- DATA FIX 2026-10-01: the showroom's petty-cash advances («تنخواه») are transfers to the petty-cash account, not expenses.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: EXPENSE rows in category 'Other' whose description names
-- «تنخواه» and the showroom ("Other - تنخواه اول SHOWROOM", "… دوم showroom",
-- "… سوم showroom", and "… چهارم مشاهیر", the showroom's address) are money
-- handed to the holder of the showroom's petty cash, not money spent.
-- Pooyan's decision: one petty-cash account, the existing «تنخواه». Each such
-- row becomes an internal transfer from its account to «تنخواه», on the same
-- date and for the same amount, in exactly the shape recordInternalTransfer
-- writes (src/actions/accounting.ts): the row itself becomes the outgoing
-- leg (TRANSFER, 'انتقال وجه', "[خروج] <its text>"), a new row on «تنخواه»
-- the incoming one ("[ورود] <its text>"), both sharing one transferGroupId;
-- «تنخواه»'s balance rises by their total. The source accounts' balances
-- stay: the money did leave them, and an outgoing leg takes it off as the
-- expense did. Profit and loss no longer counts the advances; the showroom's
-- expenses paid from the petty cash are recorded on «تنخواه». The 20M
-- "تنخواه BOOOM" is not the showroom's: datafix-2026-10-01-partner-withdrawal.sql
-- books it. Only rows on a Toman account are converted.
--
-- A copy where the first version of this fix ran has an account «تنخواه
-- showroom» holding the incoming legs: they move to «تنخواه» with their
-- amounts, and the emptied account is removed. On a fresh copy it is never
-- made. Unless exactly one account is named «تنخواه», nothing changes and
-- the run stops.
--
-- Idempotent: a converted row is no longer an EXPENSE, so a second run finds
-- nothing and adds nothing to the balance.
DO $$
DECLARE
  petty text;
  accounts integer;
  old_petty text;
  moved numeric;
  r record;
  text_of text;
  grp text;
  n integer := 0;
  total numeric := 0;
BEGIN
  SELECT count(*), min(id) INTO accounts, petty FROM "Account" WHERE name = 'تنخواه';
  IF accounts <> 1 THEN
    RAISE EXCEPTION 'petty-cash: expected one account named «تنخواه», found %; nothing changed', accounts;
  END IF;

  -- What the first version of this fix made, on a copy where it ran.
  SELECT id INTO old_petty FROM "Account" WHERE name = 'تنخواه showroom' ORDER BY "createdAt", id LIMIT 1;
  IF old_petty IS NOT NULL THEN
    WITH legs AS (
      UPDATE "Transaction" SET "accountId" = petty, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "accountId" = old_petty AND type = 'TRANSFER' AND description LIKE '[ورود] %'
      RETURNING amount
    )
    SELECT COALESCE(sum(amount), 0) INTO moved FROM legs;
    UPDATE "Account" SET balance = balance - moved, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = old_petty;
    UPDATE "Account" SET balance = balance + moved, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = petty;
    DELETE FROM "Account" a
    WHERE a.id = old_petty AND a.balance = 0 AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."accountId" = a.id);
    RAISE NOTICE 'petty-cash: % toman of incoming legs moved from «تنخواه showroom» to «تنخواه»; the emptied account removed', moved;
  END IF;

  FOR r IN
    SELECT t.id, t.amount, t.description, t.date, t."receiptUrl", t.tags
    FROM "Transaction" t JOIN "Account" a ON a.id = t."accountId"
    WHERE t.type = 'EXPENSE' AND t.category = 'Other' AND t.description LIKE '%تنخواه%'
      AND (t.description ILIKE '%showroom%' OR t.description LIKE '%مشاهیر%')
      AND a.currency = 'TOMAN' AND a.id <> petty
    ORDER BY t.date, t.id
    FOR UPDATE OF t
  LOOP
    -- The expense form stored «Other - <text>»; the transfer keeps the text.
    text_of := regexp_replace(r.description, '^Other - ', '');
    grp := gen_random_uuid()::text;
    UPDATE "Transaction"
    SET type = 'TRANSFER', category = 'انتقال وجه', description = '[خروج] ' || text_of,
        "rateSnapshot" = 1, "amountInToman" = r.amount, tags = COALESCE(r.tags, '{}'),
        "transferGroupId" = grp, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = r.id;
    INSERT INTO "Transaction" (id, amount, currency, "rateSnapshot", "amountInToman", type, "accountId", category,
                               description, tags, date, "receiptUrl", "transferGroupId", "createdAt", "updatedAt")
    VALUES ('petty-cash-in-' || r.id, r.amount, 'TOMAN', 1, r.amount, 'TRANSFER', petty, 'انتقال وجه',
            '[ورود] ' || text_of, COALESCE(r.tags, '{}'), r.date, r."receiptUrl", grp,
            (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));
    n := n + 1;
    total := total + r.amount;
  END LOOP;

  UPDATE "Account" SET balance = balance + total, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = petty AND total <> 0;
  RAISE NOTICE 'petty-cash: % advances (% toman) turned into transfers to «تنخواه»; its balance is now %',
    n, total, (SELECT balance FROM "Account" WHERE id = petty);
END $$;
