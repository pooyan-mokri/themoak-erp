-- DATA FIX 2026-10-01: purchase orders #1 and #4 were paid outside the ERP.
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: report-purchase-orders-paid-by-hand.sql lists orders #1
-- (Mellume, about 75M unpaid) and #4 (FINEWELL, about 54M unpaid). Pooyan
-- paid both outside the ERP. Each gets one PurchaseOrderPayment for what is
-- still unpaid in Toman (its Toman total less its payments), with no account
-- and no transaction, as a payment from a supplier's credit is stored, so no
-- account balance moves. Description «پرداخت‌شده بیرون از سیستم — ثبت اصلاحی»
-- (PAID_OUTSIDE_DESCRIPTION in src/lib/purchase-order-status.ts: the order
-- page names the payment «بیرون از سیستم», not the supplier's credit), dated
-- today. The status changes only as recording a payment changes it
-- (src/actions/supplier-workflow.ts): an order still PENDING_PAYMENT or
-- PARTIALLY_PAID becomes PAID; a received one (#1 RECEIVED, #4
-- PARTIALLY_RECEIVED) keeps its status. #4 is not closed short: 2 of the 10
-- units of one line are still to come (a separate question to Pooyan), so
-- the balance sheet shows what was paid for them as a prepaid purchase.
--
-- Idempotent: the payment row has a fixed id per order, and an order with
-- nothing left unpaid is skipped.
DO $$
DECLARE
  r record;
  unpaid numeric;
BEGIN
  FOR r IN
    SELECT po.id, po.number, po.status, po."totalAmountInToman"
    FROM "PurchaseOrder" po
    WHERE po.number IN (1, 4)
    ORDER BY po.number
    FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM "PurchaseOrderPayment" WHERE id = 'paid-outside-' || r.id) THEN
      RAISE NOTICE 'po-paid-outside: #% already recorded', r.number;
      CONTINUE;
    END IF;
    SELECT r."totalAmountInToman" - COALESCE(sum(p.amount), 0) INTO unpaid
    FROM "PurchaseOrderPayment" p WHERE p."purchaseOrderId" = r.id;
    IF unpaid IS NULL OR unpaid <= 1 THEN
      RAISE NOTICE 'po-paid-outside: #% has nothing unpaid (%), left', r.number, COALESCE(unpaid::text, 'no Toman total');
      CONTINUE;
    END IF;
    INSERT INTO "PurchaseOrderPayment" (id, "purchaseOrderId", amount, "accountId", "transactionId", description, date, "createdAt")
    VALUES ('paid-outside-' || r.id, r.id, unpaid, NULL, NULL, 'پرداخت‌شده بیرون از سیستم — ثبت اصلاحی', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));
    IF r.status IN ('PENDING_PAYMENT', 'PARTIALLY_PAID') THEN
      UPDATE "PurchaseOrder" SET status = 'PAID', "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = r.id;
    END IF;
    RAISE NOTICE 'po-paid-outside: #% % toman recorded as paid outside the ERP; status %', r.number, unpaid,
      (SELECT status FROM "PurchaseOrder" WHERE id = r.id);
  END LOOP;
END $$;
