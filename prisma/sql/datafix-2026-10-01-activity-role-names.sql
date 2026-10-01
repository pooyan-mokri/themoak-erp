-- DATA FIX 2026-10-01: old activity-log entries name a role by its code («با نقش PROJECT_MANAGER»).
-- Not part of the build. Run by hand, through datafix-2026-10-01-ALL.sql.
--
-- What it changes: user creations and role changes logged before the log was
-- written in Persian name the role by its code; the CRM page and the users
-- page showed it as it was. Each role code after «نقش» or «به» («… با نقش
-- ADMIN ایجاد شد», «نقش کاربر … به USER تغییر یافت») in the details of a
-- CREATE_USER or UPDATE_ROLE entry becomes the role's Persian name
-- (ROLE_LABELS, src/lib/permissions.ts). Nothing else in the text changes.
--
-- Idempotent: a second run finds no role code left.
DO $$
DECLARE
  role record;
  n integer;
  total integer := 0;
BEGIN
  FOR role IN
    SELECT * FROM (VALUES
      ('ADMIN', 'مدیر سیستم'), ('AUDITOR', 'حسابرس'), ('ACCOUNTANT', 'حسابدار'), ('SALES', 'فروشنده'),
      ('WAREHOUSE', 'انباردار'), ('PROJECT_MANAGER', 'مدیر پروژه'), ('USER', 'کاربر عادی')
    ) AS roles(code, label)
  LOOP
    UPDATE "ActivityLog"
    SET details = regexp_replace(details, '(نقش|به) ' || role.code || '\M', '\1 ' || role.label, 'g')
    WHERE action IN ('CREATE_USER', 'UPDATE_ROLE') AND details ~ ('(نقش|به) ' || role.code || '\M');
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RAISE NOTICE 'activity-role-names: % entries now name the role in Persian', total;
END $$;
