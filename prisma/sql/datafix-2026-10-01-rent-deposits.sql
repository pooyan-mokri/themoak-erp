-- DATA FIX 2026-10-01: showroom rent deposits are an asset, not an expense.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: the EXPENSE rows in category 'Rent' whose description
-- contains «ودیعه» ("Rent - بخشی از ودیعه showroom") were a deposit paid to
-- the landlord. Pooyan's decision: a rent deposit is an asset. Their category
-- becomes «ودیعه اجاره» (src/lib/profit-rows.ts), so profit and loss and the
-- expense breakdown leave them out and the balance sheet shows them under
-- «ودیعه‌ها». Amount, account, date and description stay; no balance moves.
-- Three of the six payments (1,034M) were the partner's share, lent to him:
-- datafix-2026-10-01-partner-loan.sql, run before this file, books them as
-- «قرض به شریک», so this one finds the company's own three (505M).
--
-- Idempotent: a second run finds no 'Rent' row left to change.
DO $$
DECLARE
  n integer;
  total numeric;
BEGIN
  WITH changed AS (
    UPDATE "Transaction"
    SET category = 'ودیعه اجاره', "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE type = 'EXPENSE' AND category = 'Rent' AND description LIKE '%ودیعه%'
    RETURNING "amountInToman"
  )
  SELECT count(*), COALESCE(sum("amountInToman"), 0) INTO n, total FROM changed;
  RAISE NOTICE 'rent-deposits: % rows (% toman) moved from Rent to ودیعه اجاره', n, total;
END $$;
