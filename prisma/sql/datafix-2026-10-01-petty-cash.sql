-- DATA FIX 2026-10-01: petty-cash advances («تنخواه») are transfers, not expenses.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: EXPENSE rows in category 'Other' whose description
-- contains «تنخواه» ("Other - تنخواه اول SHOWROOM") are money handed to the
-- holder of the showroom's petty cash, not money spent. Pooyan's decision:
--  1. the account «تنخواه showroom» (CASH, TOMAN) is made if no account of
--     that name exists;
--  2. each such row becomes an internal transfer from its account to that
--     account, on the same date and for the same amount, in exactly the shape
--     recordInternalTransfer writes (src/actions/accounting.ts): the row
--     itself becomes the outgoing leg (TRANSFER, 'انتقال وجه',
--     "[خروج] <its text>"), a new row on the petty-cash account is the
--     incoming leg ("[ورود] <its text>"), both sharing one transferGroupId;
--  3. the petty-cash account's balance rises by their total.
-- The source accounts' balances stay: the money did leave them, and an
-- outgoing transfer leg takes it off the same way the expense did. Profit
-- and loss no longer counts the advances; the showroom's expenses paid out of
-- the petty cash are recorded on that account from now on.
-- Only rows on a Toman account are converted (a transfer joins two accounts
-- of one currency); any other is counted in a NOTICE and left.
--
-- Idempotent: a converted row is no longer an EXPENSE, so a second run finds
-- nothing and adds nothing to the balance.
DO $$
DECLARE
  petty text;
  r record;
  text_of text;
  grp text;
  n integer := 0;
  total numeric := 0;
  skipped integer;
BEGIN
  SELECT id INTO petty FROM "Account" WHERE name = 'تنخواه showroom' ORDER BY "createdAt", id LIMIT 1;
  IF petty IS NULL THEN
    petty := 'petty-cash-showroom';
    INSERT INTO "Account" (id, name, type, currency, balance, "createdAt", "updatedAt")
    VALUES (petty, 'تنخواه showroom', 'CASH', 'TOMAN', 0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));
    RAISE NOTICE 'petty-cash: account «تنخواه showroom» created (%)', petty;
  END IF;

  SELECT count(*) INTO skipped
  FROM "Transaction" t LEFT JOIN "Account" a ON a.id = t."accountId"
  WHERE t.type = 'EXPENSE' AND t.category = 'Other' AND t.description LIKE '%تنخواه%'
    AND (a.id IS NULL OR a.currency <> 'TOMAN' OR a.id = petty);

  FOR r IN
    SELECT t.id, t."accountId", t.amount, t.description, t.date, t."receiptUrl", t.tags
    FROM "Transaction" t JOIN "Account" a ON a.id = t."accountId"
    WHERE t.type = 'EXPENSE' AND t.category = 'Other' AND t.description LIKE '%تنخواه%'
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
            '[ورود] ' || text_of, COALESCE(r.tags, '{}'), r.date, r."receiptUrl", grp, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));
    n := n + 1;
    total := total + r.amount;
  END LOOP;

  UPDATE "Account" SET balance = balance + total, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = petty AND total <> 0;
  RAISE NOTICE 'petty-cash: % expenses (% toman) turned into transfers to «تنخواه showroom»; its balance is now %; % rows not on a Toman account left',
    n, total, (SELECT balance FROM "Account" WHERE id = petty), skipped;
END $$;
