-- Every consignment partner gets its own sale channels (ConsignmentChannel).
-- A partner that has none yet keeps selling exactly as before: one default
-- channel named «پیش‌فرض» carrying the rate that was on Customer.commissionRate.
-- Idempotent: it only writes for partners with no channel at all, so re-running
-- it (every deploy does) changes nothing. Orders keep consignmentChannelId NULL,
-- which means "booked before channels" and must keep computing as it always did.
INSERT INTO "ConsignmentChannel" (
  "id", "customerId", "name", "commissionRate", "isDefault", "isActive", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'cch' || replace(gen_random_uuid()::text, '-', ''),
  c."id",
  'پیش‌فرض',
  COALESCE(c."commissionRate", 0),
  true,
  true,
  0,
  now(),
  now()
FROM "Customer" c
WHERE EXISTS (
    SELECT 1 FROM "Warehouse" w WHERE w."customerId" = c."id" AND w."isVirtual" = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ConsignmentChannel" ch WHERE ch."customerId" = c."id"
  );
