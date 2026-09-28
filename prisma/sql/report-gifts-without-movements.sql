-- READ-ONLY REPORT. Not run by the build; nothing here changes data.
--
-- Until gifts wrote an ADJUSTMENT movement, a gift took its stock without a
-- row in InventoryMovement, so the warehouse history misses it. Two kinds:
--  1. marketing gifts (MarketingGift, «هدیه بازاریابی»): the gift row names its
--     product and quantity, but not the warehouse it came from;
--  2. gifts from the product list (giftProduct): only an EXPENSE row in
--     category 'Marketing/Gift' is left; its product and warehouse were never
--     recorded, so they are listed by their description only.
--
-- Run it with psql against the database, e.g.:
--   psql "$DATABASE_URL" -f prisma/sql/report-gifts-without-movements.sql

-- 1. Marketing gifts with no movement.
SELECT
  g."date"           AS gifted_at,
  p."sku"            AS sku,
  p."name"           AS product,
  g."quantity"       AS quantity,
  g."recipientName"  AS recipient,
  g."totalCost"      AS total_cost
FROM "MarketingGift" g
JOIN "Product" p ON p."id" = g."productId"
WHERE NOT EXISTS (SELECT 1 FROM "InventoryMovement" m WHERE m."referenceId" = g."id")
ORDER BY g."date" DESC;

-- 2. Gifts from the product list with no movement.
SELECT
  t."date"          AS gifted_at,
  t."description"   AS description,
  t."amountInToman" AS cost_toman
FROM "Transaction" t
WHERE t."category" = 'Marketing/Gift'
  AND NOT EXISTS (SELECT 1 FROM "InventoryMovement" m WHERE m."referenceId" = t."id")
ORDER BY t."date" DESC;
