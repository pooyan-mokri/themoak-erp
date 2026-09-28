-- Mark the line each existing exchange issued with OrderItem.exchangeId.
--
-- An exchange can now issue several lines, and every one of them carries its
-- exchange's id (src/actions/order-exchange.ts). An exchange booked before
-- issued exactly one line, recorded only as OrderExchange.exchangeItemId; this
-- copies that link onto the line. The readers fall back to exchangeItemId, so
-- a run that fails (the build ignores it) changes nothing on screen, and the
-- next deploy retries.
--
-- Idempotent: it only fills lines whose exchangeId is still NULL, so it runs on
-- every deploy. A line two exchanges point at (the app never wrote one) is
-- left alone. One DO block, one transaction; a busy row fails the step fast
-- instead of queueing live traffic.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  UPDATE "OrderItem" i SET "exchangeId" = x.id
  FROM "OrderExchange" x
  WHERE x."exchangeItemId" = i.id
    AND x."orderId" = i."orderId"
    AND i."exchangeId" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "OrderExchange" y WHERE y."exchangeItemId" = i.id AND y.id <> x.id
    );
END $$;
