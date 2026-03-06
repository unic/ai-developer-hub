# Tasks: 007-invoice-budget-link

**Feature**: Invoice–Budget Integration
**Branch**: `007-invoice-budget-link`
**Spec**: `specs/007-invoice-budget-link/spec.md`
**Plan**: `specs/007-invoice-budget-link/plan.md`
**Created**: 2026-03-05

---

## Phase 1: Setup

- [x] T001 Install `unzipper` runtime dependency and `@types/unzipper` dev dependency via `pnpm add unzipper && pnpm add -D @types/unzipper`

---

## Phase 2: Foundational (Schema, Migration, Validators, Extraction)

**Purpose**: All Phase 3–6 tasks depend on this phase completing first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Add `vendor: varchar("vendor", { length: 255 })` (nullable) and `linkedBilledCostId: integer("linked_billed_cost_id").references(() => billedCosts.id, { onDelete: "set null" })` (nullable) columns to the `invoices` table definition in `src/lib/db/schema.ts`; add index `invoices_linked_billed_cost_id_idx` on `linked_billed_cost_id`

- [x] T003 Update Drizzle relations in `src/lib/db/schema.ts`: add `linkedBilledCost: one(billedCosts, { fields: [invoices.linkedBilledCostId], references: [billedCosts.id] })` to `invoicesRelations`; add `invoices: many(invoices)` to `billedCostsRelations`

- [x] T004 Generate the migration file by running `pnpm db:generate` (produces `src/lib/db/migrations/0004_invoice_budget_link.sql`), then apply it with `pnpm db:migrate`; verify the generated SQL adds `vendor varchar(255)`, `linked_billed_cost_id integer`, FK constraint with `ON DELETE SET NULL`, and the index `invoices_linked_billed_cost_id_idx`

- [x] T005 [P] Update `invoiceExtractionResultSchema` in `src/lib/validators.ts`: add `vendor: z.string().nullable()` field and `vendor: z.enum(["high", "medium", "low"])` to the nested `confidence` object

- [x] T006 [P] Update `createInvoiceSchema` in `src/lib/validators.ts`: add `vendor: z.string().max(255).optional()` field (the existing `export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>` automatically picks up the new field)

- [x] T007 Update `EXTRACTION_TOOL.input_schema.properties` in `src/lib/invoice-extraction.ts`: add `"vendor": { "type": ["string", "null"], "description": "Name of the vendor or company issuing the invoice. Null if not found." }`; add `vendor: { type: "string", enum: ["high", "medium", "low"] }` to the `confidence.properties` object; add `"vendor"` to both the `confidence.required` array and the top-level `required` array

- [x] T008 Update the tool-use response handler in `src/lib/invoice-extraction.ts` (inside the `try` block that builds `rawResult`): extract `vendor: typeof input.vendor === "string" ? input.vendor : null` and `confidence.vendor: (conf.vendor as "high" | "medium" | "low") ?? "low"`; add both to the `rawResult` object literal

- [x] T009 Update `regexFallback()` in `src/lib/invoice-extraction.ts`: attempt a vendor heuristic — search the first 3 lines of text for a `From:\s*(.+)` pattern or a capitalised proper-noun sequence; add `vendor: vendorMatch ? vendorMatch[1].trim() : null` and `confidence.vendor: "low"` to the returned `InvoiceExtractionResult` object so the Zod schema validation passes

**Checkpoint**: Foundation complete — user story implementation can now begin.

---

## Phase 3: US1 — Auto-Link Invoice to Budget Period (P1) 🎯 MVP

**Goal**: When an invoice is saved, automatically find the active budget period covering the invoice date, create a linked billed cost entry, and surface the result to the admin.

**Independent Test**: Upload a single PDF invoice whose date falls inside an active budget period → verify the success toast names the period, verify the period detail shows the new billed cost, verify `invoices.linked_billed_cost_id` is populated in the DB.

- [x] T010 [US1] Add internal async helper `findActivePeriodForDate(invoiceDate: string): Promise<{ id: number; periodLabel: string } | null>` at the top of `src/actions/invoices.ts` (not exported); implement with Drizzle: `db.select({ id: budgetPeriods.id, periodLabel: budgetPeriods.periodLabel }).from(budgetPeriods).innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id)).where(and(eq(annualBudgets.status, "active"), lte(budgetPeriods.startDate, invoiceDate), gt(budgetPeriods.endDate, invoiceDate))).orderBy(desc(annualBudgets.createdAt)).limit(1)`; add necessary imports (`budgetPeriods`, `annualBudgets`, `billedCosts` from schema; `and`, `lte`, `gt`, `desc` from `drizzle-orm`)

- [x] T011 [US1] Add internal async helper `insertBilledCostDirect(params: { periodId: number; amountCents: number; invoiceDate: string; invoiceNumber: string; vendor: string | null | undefined; uploadedById: number }): Promise<number>` in `src/actions/invoices.ts` (not exported); build description: `vendor ? \`Invoice ${invoiceNumber} — ${vendor}\` : \`Invoice ${invoiceNumber}\``; insert via `db.insert(billedCosts).values({ periodId, amountCents, invoiceDate, description, vendorReference: invoiceNumber }).returning({ id: billedCosts.id })`; call `recordCreation("billed_cost", costId, uploadedById)`; return the new cost `id`

- [x] T012 [US1] Update the `saveInvoice` server action in `src/actions/invoices.ts`: destructure `vendor` from `parsed.data`; include `vendor` in `db.insert(invoices).values(...)`; after inserting and calling `recordCreation`, call `findActivePeriodForDate(invoiceDate)`; if period found: call `insertBilledCostDirect(...)`, run `db.update(invoices).set({ linkedBilledCostId: costId }).where(eq(invoices.id, newId))`, return `{ success: true, data: { id: newId }, linkedPeriodLabel: period.periodLabel, ...(isDuplicate ? { warning: "..." } : {}) }`; if no period found: return `{ success: true, data: { id: newId }, linkWarning: "No active budget period covers this invoice date.", ...(isDuplicate ? { warning: "..." } : {}) }`

- [x] T013 [US1] Update `src/app/invoices/new/invoice-upload-form.tsx`: add `vendor` to the `watch()` destructure; after the `extractInvoiceFields` call, add `if (extracted.vendor) setValue("vendor", extracted.vendor)`; add a `<ConfidenceInput>` for vendor with `id="vendor"`, `label="Vendor"`, `placeholder="e.g. Acme Corp"`, `registerProps={register("vendor")}`, `confidence={confidence?.vendor}`, `watchedValue={vendor}`, `error={errors.vendor?.message}` — placed between the `amountCents` field and the submit button

- [x] T014 [US1] Update the `onSubmit` handler in `src/app/invoices/new/invoice-upload-form.tsx`: after a successful `saveInvoice` result, check `result.linkedPeriodLabel` — if present show `toast.success(\`Invoice saved. Linked to ${result.linkedPeriodLabel}.\`)`; check `result.linkWarning` — if present show `toast.warning("Invoice saved.", { description: result.linkWarning })`; preserve the existing `result.warning` (duplicate) branch; then `router.push("/invoices")`

**Checkpoint**: US1 complete — single invoice upload shows link status and budget period reflects the new billed cost.

---

## Phase 4: US2 — Vendor Field Extraction and Display (P2)

**Goal**: The vendor field is extracted by Claude, pre-filled in the upload form, stored with the invoice, and included in the linked billed cost description.

**Independent Test**: Upload a PDF with a recognisable vendor name → vendor field pre-filled (amber border if low-confidence) → save → invoice list shows vendor → linked billed cost description includes vendor name.

*Note: The vendor form field (T013) and the extraction pipeline (T007–T009) are already completed in Phases 2 and 3. The remaining US2 deliverable is the invoice list display, handled in Phase 6 (T020). No additional tasks are needed in this phase beyond what Phase 2 and Phase 3 deliver.*

**Checkpoint**: US2 complete after T020 (Phase 6) adds the Vendor column to the invoice list.

---

## Phase 5: US3 — Batch Upload via Zip File (P3)

**Goal**: Admin uploads a zip of PDFs, reviews extracted fields per file, saves all, and sees per-file outcomes.

**Independent Test**: Upload a zip with 3 PDFs → batch review screen shows 3 editable rows → save → summary shows 3 outcomes with period labels or warnings.

- [x] T015 [US3] Create `src/app/api/invoices/bulk-upload/route.ts`: export `export const maxDuration = 60`; implement `POST(request: Request)` — `requireAdmin()` → 401 if not admin; validate `Content-Type` header is `application/zip` or `application/x-zip-compressed`; read body as `await request.arrayBuffer()`; reject with 400 `{ error: "Zip file exceeds 50 MB limit" }` if `byteLength > 50 * 1024 * 1024`; open with `unzipper.Open.buffer(Buffer.from(bytes))`; filter `directory.files` to entries ending `.pdf`; collect non-PDF filenames into `skipped[]`; reject with 400 `{ error: "No PDF files found in zip" }` if zero PDFs; for each PDF (max 50, push extra names to `skipped`): read bytes, generate `objectKey = \`invoices/${randomUUID()}.pdf\``, upload to R2 via `PutObjectCommand({ Bucket: R2_BUCKET, Key: objectKey, Body: buffer, ContentType: "application/pdf" })`, build `blobUrl` from `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${objectKey}`, call `extractInvoiceFields({ objectKey })`, push `{ filename, objectKey, blobUrl, extracted: result.success ? result.data : null, error: result.success ? null : result.error }` to `results[]`; return `NextResponse.json({ results, skipped })`; wrap entire processing block in try/catch returning 500 `{ error: \`Failed to process zip: ${message}\` }`

- [x] T016 [US3] Add exported server action `saveBulkInvoices(inputs: Array<CreateInvoiceInput & { filename: string }>): Promise<ActionResult<BulkSaveOutcome[]>>` to `src/actions/invoices.ts`; define type `BulkSaveOutcome = { filename: string; invoiceId?: number; linkedPeriodLabel?: string; linkWarning?: string; error?: string }`; `requireAdmin()` → return `{ success: false, error: "Unauthorized" }` if not admin; iterate `inputs`, call `saveInvoice(input)` for each collecting per-item outcomes without aborting on individual failure; call `revalidatePath("/invoices")` once after all saves complete; return `{ success: true, data: outcomes }`

- [x] T017 [US3] Create `src/app/invoices/bulk/page.tsx` as a Server Component (no `"use client"`): call `requireAdmin()`, redirect to `/login` if not admin; render page with `<h1>Bulk Upload</h1>` and a brief description, then `<BulkUploadForm />` imported from `./bulk-upload-form`

- [x] T018 [US3] Create `src/app/invoices/bulk/bulk-upload-form.tsx` as a `"use client"` component with state machine `"idle" | "uploading" | "reviewing" | "saving" | "done" | "error"`; **Idle**: `<input type="file" accept="application/zip">` + "Upload Zip" Button; client-side reject if `file.size > 50 * 1024 * 1024`; **Uploading**: Loader2 spinner; POST zip body directly to `/api/invoices/bulk-upload` with `Content-Type: application/zip` (not FormData — avoids 4 MB form limit); **Reviewing**: TanStack Table (`useReactTable`, `getCoreRowModel`) with columns — Filename (read-only), Invoice Number (editable `<Input>`, amber border if `confidence.invoiceNumber === "low"`), Date (editable `<Input>`, amber border if low), Amount (editable `<Input type="number">`, amber border if low), Vendor (editable `<Input>`, amber border if low or null), Error (Badge if `error !== null`, row still editable); "Save All" Button calls `saveBulkInvoices(confirmedRows)`; **Done**: summary table with filename / invoiceId / period label or warning / error badge per row; "Back to Invoices" Link; include ARIA live region `role="status" aria-live="polite" aria-atomic="true" className="sr-only"` announcing state transitions (follow the `ARIA_STATUS` pattern from `src/app/invoices/new/invoice-upload-form.tsx`)

**Checkpoint**: US3 complete — zip batch upload processes multiple PDFs with review and per-file outcome reporting.

---

## Phase 6: Polish — Invoice List Updates and Nav Link

**Purpose**: Surface vendor and linked period in the invoice archive; add navigation to bulk upload.

- [x] T019 [P] Update `src/app/invoices/page.tsx`: add a "Bulk Upload" Button (variant `"outline"`) wrapped with `<Link href="/invoices/bulk">` in the page header area alongside the existing "Upload Invoice" button

- [x] T020 Update `src/app/invoices/page.tsx`: extend the DB query to also select `vendor: invoices.vendor` and `linkedBilledCostId: invoices.linkedBilledCostId`; add a left join to `billedCosts` on `eq(invoices.linkedBilledCostId, billedCosts.id)` and a further left join to `budgetPeriods` on `eq(billedCosts.periodId, budgetPeriods.id)` to select `periodLabel: budgetPeriods.periodLabel`; add `<TableHead>Vendor</TableHead>` and `<TableHead>Budget Period</TableHead>` to the table header; add `<TableCell>{invoice.vendor ?? "—"}</TableCell>` and `<TableCell>{invoice.periodLabel ?? "—"}</TableCell>` to each row

---

## Dependencies

```
T001 (install unzipper)
  └─► T015 (bulk-upload route uses unzipper)

T002 + T003 (schema columns + relations — do together)
  └─► T004 (pnpm db:generate && pnpm db:migrate)
      ├─► T005 [P] (validators: invoiceExtractionResultSchema)
      ├─► T006 [P] (validators: createInvoiceSchema)
      └─► T020 (invoice list columns)

T005 + T006 (both validators updated)
  └─► T007 → T008 → T009 (extraction tool — sequential, same file)
      └─► T010 → T011 → T012 (saveInvoice logic — sequential, same file)
          └─► T013 → T014 (form vendor field + link status — sequential, same file)
              └─► T016 (saveBulkInvoices — same file as T012)
                  └─► T015 (bulk-upload route)
                      └─► T017 → T018 (bulk page + form)

T004 (migration applied)
  └─► T019 (nav link — independent)
```

---

## Parallel Execution Examples

```text
# Phase 2 — after T004 completes, run T005 and T006 together:
Task: "Update invoiceExtractionResultSchema in src/lib/validators.ts" (T005)
Task: "Update createInvoiceSchema in src/lib/validators.ts" (T006)
# Note: both touch the same file — assign to one implementer in a single session

# Phase 6 — T019 and T020 both edit src/app/invoices/page.tsx:
# Do in a single session to avoid conflicts (do NOT parallelize these two)
```

---

## Implementation Strategy

### MVP First (US1 only — Phases 1–3)

1. **T001** — Install unzipper
2. **T002–T009** — Foundation (schema, migration, validators, extraction)
3. **T010–T014** — US1 auto-link logic + form update
4. **STOP AND VALIDATE**: Upload a PDF, confirm link toast, confirm billed cost in budget period
5. Deploy/demo if ready

### Incremental Delivery

- **After Phase 3**: US1 complete → admins no longer need to double-enter invoice amounts
- **After Phase 6**: US2 complete → vendor name visible in archive and billed cost descriptions
- **After Phase 5**: US3 complete → batch processing reduces monthly reconciliation time

### Files per session (avoid conflicts)

| Session | Tasks | Files touched |
|---------|-------|--------------|
| 1 | T001 | — (CLI only) |
| 2 | T002, T003 | `src/lib/db/schema.ts` |
| 3 | T004 | CLI + generated migration |
| 4 | T005, T006 | `src/lib/validators.ts` |
| 5 | T007, T008, T009 | `src/lib/invoice-extraction.ts` |
| 6 | T010, T011, T012, T016 | `src/actions/invoices.ts` |
| 7 | T013, T014 | `src/app/invoices/new/invoice-upload-form.tsx` |
| 8 | T015 | `src/app/api/invoices/bulk-upload/route.ts` (NEW) |
| 9 | T017, T018 | `src/app/invoices/bulk/page.tsx` (NEW), `src/app/invoices/bulk/bulk-upload-form.tsx` (NEW) |
| 10 | T019, T020 | `src/app/invoices/page.tsx` |

---

## Notes

- **Monetary values**: All amounts are integer cents; never floating-point
- **Boundary rule for period matching**: `startDate <= invoiceDate < endDate` — use Drizzle `lte` and `gt` operators
- **Bulk upload body**: Use `request.arrayBuffer()`, NOT `request.formData()`, in the bulk route to handle files > 4 MB
- **Orphan R2 cleanup**: If the bulk route fails mid-batch, attempt `DeleteObjectCommand` on already-uploaded keys to prevent orphaned objects (follow the pattern in `saveInvoice`)
- **`revalidatePath` once**: Call `revalidatePath("/invoices")` once at the end of `saveBulkInvoices`, not per-invoice
- **No tests**: The spec does not request TDD — do not generate test files
