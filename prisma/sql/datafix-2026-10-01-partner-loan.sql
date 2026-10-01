-- DATA FIX 2026-10-01: the partner's share of the showroom deposit was a loan, and «دریافت مبلغ ودیعه مشاهیر» its repayment.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: Pooyan: "we paid our partner's share of the deposit, and
-- he repaid his loan." Of the six showroom deposit payments ("Rent - بخشی از
-- ودیعه showroom", 1,539M), three make up exactly the 1,034M the partner paid
-- back: the two of 500,000,000 on 2026-07-19 20:30 and the one of 34,000,000
-- on 2026-07-27 20:30 (UTC). They become «قرض به شریک» (money lent to a
-- partner), and the INCOME row «دریافت مبلغ ودیعه مشاهیر» of 1,034,000,000
-- on 2026-08-09 11:28:31.7, until now counted as revenue, becomes «بازپرداخت
-- قرض شریک». Neither is profit and loss (src/lib/profit-rows.ts); the
-- balance sheet's «طلب از شرکا» is lent − repaid = 0, and the company's own
-- «ودیعه‌ها» is 1,539M − 1,034M = 505M. No balance moves.
--
-- The rows are found by type, description, amount and date, in whichever
-- category they are now ('Rent' as booked, «ودیعه اجاره» after
-- datafix-2026-10-01-rent-deposits.sql, or already changed); unless exactly
-- these three and this one are found, nothing changes and the run stops.
--
-- Idempotent: a second run finds them changed and changes nothing.
DO $$
DECLARE
  found text;
  n integer;
  income_rows integer;
BEGIN
  SELECT string_agg(amount::bigint || '@' || to_char(date, 'YYYY-MM-DD HH24:MI'), ' ' ORDER BY date, amount), count(*)
    INTO found, n
  FROM "Transaction"
  WHERE type = 'EXPENSE'
    AND description = 'Rent - بخشی از ودیعه showroom'
    AND category IN ('Rent', 'ودیعه اجاره', 'قرض به شریک')
    AND ((amount = 500000000 AND date = '2026-07-19 20:30:00') OR (amount = 34000000 AND date = '2026-07-27 20:30:00'));
  IF n <> 3 OR found <> '500000000@2026-07-19 20:30 500000000@2026-07-19 20:30 34000000@2026-07-27 20:30' THEN
    RAISE EXCEPTION 'partner-loan: expected the two 500M payments of 2026-07-19 and the 34M of 2026-07-27, found % (%); nothing changed', n, COALESCE(found, 'none');
  END IF;

  SELECT count(*) INTO income_rows
  FROM "Transaction"
  WHERE type = 'INCOME'
    AND description = 'دریافت مبلغ ودیعه مشاهیر'
    AND category IN ('واریز بانکی', 'بازپرداخت قرض شریک')
    AND amount = 1034000000
    AND date = '2026-08-09 11:28:31.7';
  IF income_rows <> 1 THEN
    RAISE EXCEPTION 'partner-loan: expected one 1,034M «دریافت مبلغ ودیعه مشاهیر» of 2026-08-09, found %; nothing changed', income_rows;
  END IF;

  UPDATE "Transaction" SET category = 'قرض به شریک', "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE type = 'EXPENSE'
    AND description = 'Rent - بخشی از ودیعه showroom'
    AND category IN ('Rent', 'ودیعه اجاره')
    AND ((amount = 500000000 AND date = '2026-07-19 20:30:00') OR (amount = 34000000 AND date = '2026-07-27 20:30:00'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'partner-loan: % of the 3 payments (1,034,000,000 in all) moved to «قرض به شریک»', n;

  UPDATE "Transaction" SET category = 'بازپرداخت قرض شریک', "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE type = 'INCOME'
    AND description = 'دریافت مبلغ ودیعه مشاهیر'
    AND category = 'واریز بانکی'
    AND amount = 1034000000
    AND date = '2026-08-09 11:28:31.7';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'partner-loan: % of the 1 repayment row moved to «بازپرداخت قرض شریک»', n;
END $$;
