-- READ-ONLY report. Not part of the build; changes nothing.
--
-- Employee national ids and phones are now saved with Latin digits, so the
-- uniqueness check sees «۰۰۱۲۳۴۵۶۷۸» and «0012345678» as the same id. Rows saved
-- before keep their Persian or Arabic-Indic digits. This lists every employee
-- whose national id or phone has them, and, in the last column, how many
-- employees share that national id once the digits are read as Latin (more
-- than 1 means the same person may have been entered twice).
WITH normalised AS (
  SELECT
    e."id",
    e."name",
    e."nationalId",
    e."phone",
    translate(e."nationalId", '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') AS national_latin
  FROM "Employee" e
)
SELECT
  n."id",
  n."name",
  n."nationalId",
  n."phone",
  n.national_latin,
  (SELECT COUNT(*) FROM normalised m WHERE m.national_latin = n.national_latin) AS same_id_count
FROM normalised n
WHERE n."nationalId" ~ '[۰-۹٠-٩]' OR n."phone" ~ '[۰-۹٠-٩]'
ORDER BY n.national_latin, n."name";
