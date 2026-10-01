-- DATA FIX 2026-10-01: order #121 was paid 16M, not 18M; the 18M was a recording error.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: order #121 (total 16,000,000, no discount) shows
-- 18,000,000 paid, from its one checkout row of 18,000,000
-- (report-legacy-overpaid-orders.sql). Pooyan: a recording error.
--  1. The checkout row becomes 16,000,000 (amount and Toman equivalent), the
--     order's paid amount 16,000,000, and its payment status is recomputed as
--     the app computes it (src/lib/site-sale.ts paymentStatusFor, on
--     src/lib/order-balance.ts's net): PAID when paid reaches the net.
--  2. That account was reconciled to the bank (0) on 1405/06/30 by an
--     «اصلاح موجودی» row of −1,569,900, which already absorbed the 2M that
--     never came. Taking the 2M off the checkout row, that correction becomes
--     2,000,000 smaller in the other direction: −1,569,900 + 2,000,000 =
--     +430,100, with a note added to its description. The account's balance
--     stays 0 (−2M, +2M) and its ledger still adds up.
-- Unless the order is exactly as described — total 16M, no discount, paid
-- 18M, no invoice, one money row of 18M on a Toman account (its
-- cost-of-goods-sold row aside) — and that account has exactly one
-- «اصلاح موجودی» row on 1405/06/30 of −1,569,900, nothing changes and the
-- run stops.
--
-- Idempotent: once the checkout is 16M and the correction +430,100, a second
-- run changes nothing. A copy where the earlier form of this fix ran (the
-- checkout corrected, the account left 2M down) gets step 2 only.
DO $$
DECLARE
  o record;
  rows_n integer;
  row_id text;
  row_amount numeric;
  row_account text;
  row_currency text;
  corrections integer;
  correction record;
  net numeric;
  new_status text;
  order_done boolean;
BEGIN
  SELECT * INTO o FROM "Order" WHERE number = 121 FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'order-121: order #121 not found; nothing changed';
  END IF;
  SELECT count(*), min(t.id), min(t.amount), min(t."accountId"), min(a.currency::text)
    INTO rows_n, row_id, row_amount, row_account, row_currency
  FROM "Transaction" t LEFT JOIN "Account" a ON a.id = t."accountId"
  -- Its money: every row linked to it but its cost of goods sold (datafix-2026-10-01-cogs-backfill.sql books one).
  WHERE (t."orderId" = o.id OR t.id = o."transactionId") AND t.category IS DISTINCT FROM 'COGS';

  order_done := o."paidAmount" = 16000000 AND rows_n = 1 AND row_amount = 16000000;
  IF NOT order_done AND (
       o."totalAmount" <> 16000000 OR o.discount <> 0 OR o."paidAmount" <> 18000000 OR o."invoiceId" IS NOT NULL
       OR o."wooId" IS NOT NULL OR o."siteReference" IS NOT NULL
       OR rows_n <> 1 OR row_amount <> 18000000 OR row_currency IS DISTINCT FROM 'TOMAN'
       OR (SELECT type FROM "Transaction" WHERE id = row_id) <> 'INCOME') THEN
    RAISE EXCEPTION 'order-121: not as described (total %, discount %, paid %, % money rows, first %); nothing changed',
      o."totalAmount", o.discount, o."paidAmount", rows_n, row_amount;
  END IF;

  -- The reconciliation of 1405/06/30 (2026-09-20 20:30 to 2026-09-21 20:30 UTC) on the same account.
  SELECT count(*) INTO corrections
  FROM "Transaction"
  WHERE "accountId" = row_account AND type = 'ADJUSTMENT' AND category = 'اصلاح موجودی'
    AND date >= '2026-09-20 20:30:00' AND date < '2026-09-21 20:30:00';
  SELECT * INTO correction
  FROM "Transaction"
  WHERE "accountId" = row_account AND type = 'ADJUSTMENT' AND category = 'اصلاح موجودی'
    AND date >= '2026-09-20 20:30:00' AND date < '2026-09-21 20:30:00'
  FOR UPDATE;
  IF corrections <> 1 OR correction.amount NOT IN (-1569900, 430100) OR (correction.amount = 430100 AND NOT order_done) THEN
    RAISE EXCEPTION 'order-121: expected one «اصلاح موجودی» of −1,569,900 on 1405/06/30 on the account, found % (%); nothing changed',
      corrections, correction.amount;
  END IF;

  IF order_done AND correction.amount = 430100 THEN
    RAISE NOTICE 'order-121: already corrected; nothing changed';
    RETURN;
  END IF;

  IF NOT order_done THEN
    UPDATE "Transaction" SET amount = 16000000, "amountInToman" = 16000000, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = row_id;
    UPDATE "Account" SET balance = balance - 2000000, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = row_account;
    net := GREATEST(0, o."totalAmount" - o.discount);
    new_status := CASE WHEN 16000000 >= net THEN 'PAID' WHEN 16000000 > 0 THEN 'PARTIAL' ELSE 'UNPAID' END;
    UPDATE "Order" SET "paidAmount" = 16000000, "paymentStatus" = new_status, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = o.id;
    RAISE NOTICE 'order-121: paid 18,000,000 → 16,000,000 (status %)', new_status;
  END IF;

  UPDATE "Transaction"
  SET amount = 430100, "amountInToman" = 430100,
      description = COALESCE(description, '') || ' — ۲٬۰۰۰٬۰۰۰ از این اصلاح ثبت اشتباه پرداخت سفارش #۱۲۱ بود که اصلاح شد (۱۴۰۵/۰۷/۰۹)؛ اصلاح موجودی از −۴۳۰٬۱۰۰ به ۰',
      "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE id = correction.id;
  UPDATE "Account" SET balance = balance + 2000000, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = row_account;
  RAISE NOTICE 'order-121: the 1405/06/30 correction on % is now +430,100; its balance is %',
    row_account, (SELECT balance FROM "Account" WHERE id = row_account);
END $$;
