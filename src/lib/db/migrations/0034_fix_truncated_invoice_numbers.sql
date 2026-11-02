-- Anthropic receipt numbers are stored as "PREFIX SUFFIX" (one space).
-- "K6EV5YRI-0101" and "K6EV5YRI 0101" are the same invoice. Collapse a
-- single dash so a re-ingest of an old PBC receipt matches the row.
-- Already-canonical values do not match the WHERE, so this is idempotent.
UPDATE "invoices"
SET
  "invoice_number" = replace("invoice_number", '-', ' '),
  "updated_at" = NOW()
WHERE "invoice_number" ~ '^[A-Z0-9]{8}-[0-9]+$';
--> statement-breakpoint
UPDATE "billed_costs"
SET
  "description" = replace("description", "vendor_reference", replace("vendor_reference", '-', ' ')),
  "vendor_reference" = replace("vendor_reference", '-', ' '),
  "updated_at" = NOW()
WHERE "vendor_reference" ~ '^[A-Z0-9]{8}-[0-9]+$';
--> statement-breakpoint
-- Invoice 216 was stored as the truncated prefix "9BF0758D".
-- The receipt is 9BF0758D-10147934, $67.08, paid 2026-10-24
-- (Anthropic Ireland, Limited). Match id AND the truncated number AND
-- the amount and date so a database where id 216 is some other row is
-- left alone. A second run matches nothing.
UPDATE "invoices"
SET
  "invoice_number" = '9BF0758D 10147934',
  "updated_at" = NOW()
WHERE "id" = 216
  AND "invoice_number" = '9BF0758D'
  AND "amount_cents" = 6708
  AND "invoice_date" = DATE '2026-10-24';
--> statement-breakpoint
UPDATE "billed_costs" AS bc
SET
  "vendor_reference" = '9BF0758D 10147934',
  "description" = CASE
    WHEN bc."description" LIKE '%9BF0758D 10147934%' THEN bc."description"
    ELSE replace(bc."description", '9BF0758D', '9BF0758D 10147934')
  END,
  "updated_at" = NOW()
FROM "invoices" AS i
WHERE i."id" = 216
  AND i."invoice_number" = '9BF0758D 10147934'
  AND i."amount_cents" = 6708
  AND i."invoice_date" = DATE '2026-10-24'
  AND bc."id" = i."linked_billed_cost_id"
  AND (
    bc."vendor_reference" = '9BF0758D'
    OR (
      bc."vendor_reference" = '9BF0758D 10147934'
      AND bc."description" NOT LIKE '%9BF0758D 10147934%'
    )
  );

-- Invoice 209 is stored as "K6EV5YRI" ($4.27, 2026-08-11). That is the same
-- truncation, but the numeric suffix is not on the row and the source PDF
-- is not in this repository. Left unchanged for a manual correction once
-- the PDF in object storage is opened. Do not guess the suffix.
