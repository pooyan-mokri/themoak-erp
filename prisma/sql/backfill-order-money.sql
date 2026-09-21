-- Link existing money rows to their order (Transaction.orderId), for rows
-- written before the writers set it. cancelOrder reverses an order's money
-- through this column, so a row left unlinked would stay booked after a cancel.
--
-- (a) the row an order points at (Order.transactionId): the checkout income,
--     or a consignment order's last settlement;
-- (b) the row a return, an exchange or a website refund points at;
-- (c) an INCOME or EXPENSE row whose description names one order, «سفارش #N»
--     with N not followed by another digit (#39 is not #394), and that is
--     linked to nothing else: payments entered through «ثبت پرداخت»,
--     consignment settlements and their COGS/commission rows.
--     Only rows in the wording the app itself writes for an order's money.
--     A row typed by hand that mentions an order (a courier or shipping cost
--     «... سفارش #394») is money that really moved for its own reason: linked,
--     a cancel of the order would delete it and put its amount back on the bank.
--     A transfer leg or a balance correction is a movement of its own too.
--
-- Idempotent: it only fills rows whose orderId is still NULL, so it runs on
-- every deploy. One DO block, one transaction; a busy row fails the step fast
-- (the build ignores the failure) instead of queueing live traffic.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- (a) Only a row exactly one order points at.
  UPDATE "Transaction" t SET "orderId" = o.id
  FROM "Order" o
  WHERE o."transactionId" = t.id
    AND t."orderId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Order" o2 WHERE o2."transactionId" = t.id AND o2.id <> o.id);

  -- (b) Each of these transactionId columns is unique.
  UPDATE "Transaction" t SET "orderId" = r."orderId"
  FROM "OrderReturn" r
  WHERE r."transactionId" = t.id AND t."orderId" IS NULL;

  UPDATE "Transaction" t SET "orderId" = x."orderId"
  FROM "OrderExchange" x
  WHERE x."transactionId" = t.id AND t."orderId" IS NULL;

  UPDATE "Transaction" t SET "orderId" = sr."orderId"
  FROM "SiteRefund" sr
  WHERE sr."transactionId" = t.id AND t."orderId" IS NULL;

  -- (c) The digits are compared as text, so no description can overflow a cast.
  UPDATE "Transaction" t SET "orderId" = o.id
  FROM (
    SELECT m.id, min(m.num) AS num
    FROM (
      SELECT tr.id, (regexp_matches(tr.description, 'سفارش #([0-9]+)', 'g'))[1] AS num
      FROM "Transaction" tr
      WHERE tr."orderId" IS NULL
        -- The descriptions sales.ts, consignment.ts, order-return.ts and
        -- order-exchange.ts write (and the older consignment settlement text).
        AND tr.description ~ '^(دریافت بابت|تسویه فروش امانی -|تسویه حساب امانی -|بهای تمام‌شده کالای فروش امانی -|کمیسیون همکار امانی -|عودت کالا -|تعویض کالا -) سفارش #[0-9]'
    ) m
    GROUP BY m.id
    HAVING count(DISTINCT m.num) = 1
  ) named
  JOIN "Order" o ON o.number::text = named.num
  WHERE t.id = named.id
    AND t."orderId" IS NULL
    AND t.type IN ('INCOME', 'EXPENSE')
    -- A row of another customer is not this order's money.
    AND (t."customerId" IS NULL OR t."customerId" = o."customerId")
    -- Linked to nothing else.
    AND t."exchangeGroupId" IS NULL
    AND t."transferGroupId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Order" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "OrderReturn" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "OrderExchange" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "SiteRefund" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "LoanPayment" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "MarketingGift" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "PayrollPayment" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "ShareholderWithdrawal" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "PurchaseOrder" x WHERE x."paymentTransactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderPayment" x WHERE x."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderArrivalCost" x WHERE x."transactionId" = t.id);
END $$;
