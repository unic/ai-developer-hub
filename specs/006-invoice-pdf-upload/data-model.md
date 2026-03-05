# Data Model: Invoice PDF Upload & Auto-Processing

**Feature**: `006-invoice-pdf-upload`
**Phase**: 1 — Design
**Date**: 2026-03-05

---

## New Table: `invoices`

This feature introduces a single new table. The invoice archive is standalone — it has no foreign key to `budget_periods` or `billed_costs`.

### Drizzle Schema (to add to `src/lib/db/schema.ts`)

```ts
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 255 }).notNull(),
  invoiceDate: date("invoice_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  blobUrl: text("blob_url").notNull(),
  blobPathname: text("blob_pathname").notNull(),
  uploadedBy: integer("uploaded_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const invoicesRelations = relations(invoices, ({ one }) => ({
  uploader: one(users, {
    fields: [invoices.uploadedBy],
    references: [users.id],
  }),
}));
```

### Column Reference

| Column | Drizzle Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | Auto-incrementing primary key |
| `invoice_number` | `varchar(255)` | NOT NULL | Vendor-assigned invoice identifier (e.g. `INV-1042`) |
| `invoice_date` | `date` | NOT NULL | Date printed on the invoice (ISO 8601) |
| `amount_cents` | `integer` | NOT NULL, > 0 | Grand total amount in integer cents (never float) |
| `blob_url` | `text` | NOT NULL | Permanent Vercel Blob private URL for the PDF |
| `blob_pathname` | `text` | NOT NULL | Vercel Blob pathname used by the download proxy |
| `uploaded_by` | `integer` | NOT NULL, FK → users.id | Admin user who uploaded the invoice |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | Record creation time |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Last modification time |

### Notes
- `invoice_number` is not constrained to be unique at the DB level; a soft duplicate check is performed in the Server Action (warns user, allows override per FR-008).
- `amount_cents` stores the grand total only — no subtotal or tax breakdown.
- `blob_url` and `blob_pathname` are both stored: `blob_url` is the full HTTPS URL returned by Vercel Blob; `blob_pathname` is the path-only portion needed by the download proxy (`get(pathname, { access: 'private' })`).
- No `deleted_at` / soft delete in v1. Invoice records are permanent once saved (spec has no delete requirement).

---

## Validation Rules

### Zod Schemas (to add to `src/lib/validators.ts`)

```ts
// Used when the admin confirms and saves the invoice
export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(255),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine((v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const [y, m, day] = v.split("-").map(Number);
      return (
        d.getUTCFullYear() === y &&
        d.getUTCMonth() + 1 === m &&
        d.getUTCDate() === day
      );
    }, "Invalid calendar date"),
  amountCents: z.number().int().positive("Amount must be a positive integer (cents)"),
  blobUrl: z.string().url(),
  blobPathname: z.string().min(1),
});

// Result type returned from extraction
export const invoiceExtractionResultSchema = z.object({
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  amountCents: z.number().int().positive().nullable(),
  confidence: z.object({
    invoiceNumber: z.enum(["high", "medium", "low"]),
    invoiceDate: z.enum(["high", "medium", "low"]),
    amountCents: z.enum(["high", "medium", "low"]),
  }),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceExtractionResult = z.infer<typeof invoiceExtractionResultSchema>;
```

---

## Entity Relationships

```
users (existing)
  │
  │ 1:N (uploaded_by → id)
  ▼
invoices (new)
  - id
  - invoice_number
  - invoice_date
  - amount_cents
  - blob_url
  - blob_pathname
  - uploaded_by
  - created_at
  - updated_at
```

No relationships to `billed_costs`, `budget_periods`, or `ai_tools`. The invoice archive is intentionally decoupled from the budget tracking system in v1.

---

## Migration

Run after adding the Drizzle schema changes:

```bash
pnpm db:generate   # generates migration file in src/lib/db/migrations/
pnpm db:migrate    # applies migration to Neon DB
```

The migration creates the `invoices` table with the FK constraint to `users.id`.

---

## TypeScript Types (to add to `src/types/index.ts`)

```ts
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
```
