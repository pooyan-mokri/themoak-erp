-- DATA FIX 2026-10-01: order #121 was paid 16M, not 18M; the 18M was a recording error.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: order #121 (total 16,000,000, no discount) shows
-- 18,000,000 paid, from its one checkout row of 18,000,000
-- (report-legacy-overpaid-orders.sql). Pooyan: a recording error. The
-- checkout row becomes 16,000,000 (amount and Toman equivalent), its
-- account's balance goes 2,000,000 down, the order's paid amount becomes
-- 16,000,000, and its payment status is recomputed as the app computes it
-- (src/lib/site-sale.ts paymentStatusFor, on src/lib/order-balance.ts's net):
-- PAID when paid reaches the net, PARTIAL when some is paid, else UNPAID.
-- Unless the order is exactly as described — total 16M, no discount, paid
-- 18M, no invoice, one money row of 18M on a Toman account and no other
-- (its cost-of-goods-sold row aside) —
-- nothing changes and the run stops.
--
-- Idempotent: once paid is 16M on a 16M row, a second run changes nothing.
DO $$
DECLARE
  o record;
  rows_n integer;
  row_id text;
  row_amount numeric;
  row_account text;
  row_currency text;
  net numeric;
  new_status text;
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

  IF o."paidAmount" = 16000000 AND rows_n = 1 AND row_amount = 16000000 THEN
    RAISE NOTICE 'order-121: already corrected; nothing changed';
    RETURN;
  END IF;
  IF o."totalAmount" <> 16000000 OR o.discount <> 0 OR o."paidAmount" <> 18000000 OR o."invoiceId" IS NOT NULL
     OR o."wooId" IS NOT NULL OR o."siteReference" IS NOT NULL
     OR rows_n <> 1 OR row_amount <> 18000000 OR row_currency IS DISTINCT FROM 'TOMAN'
     OR (SELECT type FROM "Transaction" WHERE id = row_id) <> 'INCOME' THEN
    RAISE EXCEPTION 'order-121: not as described (total %, discount %, paid %, % money rows, first %); nothing changed',
      o."totalAmount", o.discount, o."paidAmount", rows_n, row_amount;
  END IF;

  UPDATE "Transaction" SET amount = 16000000, "amountInToman" = 16000000, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = row_id;
  UPDATE "Account" SET balance = balance - 2000000, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = row_account;
  net := GREATEST(0, o."totalAmount" - o.discount);
  new_status := CASE WHEN 16000000 >= net THEN 'PAID' WHEN 16000000 > 0 THEN 'PARTIAL' ELSE 'UNPAID' END;
  UPDATE "Order" SET "paidAmount" = 16000000, "paymentStatus" = new_status, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = o.id;
  RAISE NOTICE 'order-121: paid 18,000,000 → 16,000,000 (status %); account % down 2,000,000', new_status, row_account;
END $$;
