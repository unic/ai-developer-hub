# Tasks: Invoice PDF Upload & Auto-Processing (006-invoice-pdf-upload)

**Branch**: `006-invoice-pdf-upload` → PR target: `main`
**Created**: 2026-03-05
**Spec**: `specs/006-invoice-pdf-upload/spec.md`
**Plan**: `specs/006-invoice-pdf-upload/plan.md`

---

## Implementation Strategy

The feature is built in strict dependency order across six phases:

1. **Setup** establishes the runtime prerequisites (packages, env vars, Cloudflare R2 bucket) that every subsequent phase depends on.
2. **Foundational** delivers the DB schema, Zod validators, TypeScript types, and the extraction library — shared by all story phases. Nothing in phases 3–5 can be built without these in place.
3. **US1 (Happy Path)** wires the complete upload → extract → confirm → save flow. The upload token Route Handler, extraction Server Action, save Server Action, upload page, and client component all belong here because they are parts of a single sequential workflow.
4. **US2 (Error/Uncertainty UX)** builds on the confirmation form from US1. It adds confidence-driven amber highlighting, empty-field warnings, and duplicate-number warning display — purely additive UI changes on top of the already-wired form.
5. **US3 (Archive & Download)** adds the invoice list Server Component and the authenticated PDF download Route Handler. These read-only features have no dependency on US2.
6. **Polish** closes out nav integration, empty states, ARIA live regions, skeleton loaders, and the final lint/typecheck gate — applied across all new files.

Phases 4 and 5 are independent of each other and can be parallelized once Phase 3 is complete.

---

## Phase 1: Setup

- [X] T001 Verify `@anthropic-ai/sdk` presence in `package.json`; add `unpdf`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner` with `pnpm add unpdf @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @anthropic-ai/sdk` and confirm `package.json` reflects all four dependencies
- [X] T002 Add `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, and `ANTHROPIC_API_KEY` to `.env.local` and confirm all five are listed in `.env.example` at the repo root
- [X] T003 Follow the R2 bucket creation steps in `specs/006-invoice-pdf-upload/quickstart.md` (Cloudflare dashboard → R2 → Create bucket "invoice-pdfs" → Create API Token with Object Read & Write on that bucket) and confirm all four R2 env vars are populated locally

---

## Phase 2: Foundational

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Add the `invoices` Drizzle table definition and `invoicesRelations` to `src/lib/db/schema.ts` (columns: `id`, `invoiceNumber`, `invoiceDate`, `amountCents`, `blobUrl`, `blobPathname`, `uploadedBy` FK → `users.id`, `createdAt`, `updatedAt`) as specified in `specs/006-invoice-pdf-upload/data-model.md`
- [X] T005 [P] Add `createInvoiceSchema`, `invoiceExtractionResultSchema`, `CreateInvoiceInput`, and `InvoiceExtractionResult` to `src/lib/validators.ts` as specified in `specs/006-invoice-pdf-upload/data-model.md`
- [X] T006 [P] Add `Invoice` and `NewInvoice` inferred types from the new Drizzle table to `src/types/index.ts`
- [X] T007 Generate and apply the Drizzle migration: run `pnpm db:generate` (creates file under `src/lib/db/migrations/`) then `pnpm db:migrate`; confirm the `invoices` table exists in Neon (depends on T004)
- [X] T008 Create `src/lib/invoice-extraction.ts` implementing `extractInvoiceFields({ objectKey: string })`: fetch PDF bytes from R2 using `GetObjectCommand` (S3Client configured with the R2 endpoint `https://<CLOUDFLARE_R2_ACCOUNT_ID>.r2.cloudflarestorage.com`), extract text with `unpdf` (`getDocumentProxy` + `extractText(pdf, { mergePages: true })`), return error when text < 50 chars, call `claude-haiku-4-5` with forced tool use (`extract_invoice_fields` tool schema from `specs/006-invoice-pdf-upload/research.md`), fall back to regex heuristics with all-`"low"` confidence on API error, validate result against `invoiceExtractionResultSchema`

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: US1 — Upload and Auto-Process Invoice PDF (Priority: P1) 🎯 MVP

**Goal**: Admin uploads a PDF, fields are auto-extracted, confirmation form is pre-filled, admin saves to archive

**Independent Test**: Upload a machine-readable PDF invoice → verify all three fields are pre-populated → confirm → verify record appears in `/invoices`

- [X] T009 [P] [US1] Create `src/app/api/invoices/upload-url/route.ts` implementing `POST /api/invoices/upload-url`: call `auth()` and return `401` for non-admin sessions; validate `contentType === "application/pdf"` (return `400` otherwise); generate `objectKey = "invoices/<uuid>.pdf"`; use `getSignedUrl` from `@aws-sdk/s3-request-presigner` with `PutObjectCommand` and `expiresIn: 300` (5 min); return `{ uploadUrl, objectKey }`
- [X] T010 [P] [US1] Create `src/actions/invoices.ts` with the `extractInvoiceFields` Server Action (`"use server"`): accept `{ objectKey: string }`, call `requireAdmin()`, delegate to `src/lib/invoice-extraction.ts`, return `ActionResult<InvoiceExtractionResult>`
- [X] T011 [US1] Add the `saveInvoice` Server Action to `src/actions/invoices.ts`: accept `CreateInvoiceInput`, call `requireAdmin()`, validate with `createInvoiceSchema.safeParse`, run duplicate `invoiceNumber` soft check (return `warning` on match, not an error), `db.insert(invoices)`, call `recordCreation("invoice", newId, adminId)`, on DB failure call `DeleteObjectCommand(input.blobPathname)` via the R2 S3Client for orphan cleanup, call `revalidatePath("/invoices")`, return `{ success: true, data: { id }, warning? }` (depends on T010)
- [X] T012 [US1] Create `src/app/invoices/new/invoice-upload-form.tsx` as a `"use client"` component: file `<input accept="application/pdf">` with client-side MIME check; on selection call `POST /api/invoices/upload-url` to get `{ uploadUrl, objectKey }`, then `fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } })`; on upload success call `extractInvoiceFields({ objectKey })` Server Action; render a React Hook Form + `zodResolver(createInvoiceSchema)` confirmation form pre-filled with extracted values, with `blobPathname` (objectKey) as a hidden field; on submit call `saveInvoice`; show `toast.success` + `router.push("/invoices")` on success; show `toast.error` on failure (depends on T010, T011)
- [X] T013 [P] [US1] Create `src/app/invoices/new/page.tsx` as a Server Component: call `requireAdmin()`, render heading "Upload Invoice", mount `<InvoiceUploadForm />`
- [X] T014 [US1] Create `src/app/invoices/page.tsx` as a Server Component: call `requireAdmin()`, query `db.select().from(invoices).orderBy(desc(invoices.createdAt))`, render a shadcn/ui `<Table>` with columns: Invoice Number, Date (`formatDate`), Amount (`formatCurrency`), Uploaded By, Download link to `/api/invoices/[id]/pdf` (depends on T004)

**Checkpoint**: US1 fully functional — upload, extraction, confirmation, and archive list all work end-to-end

---

## Phase 4: US2 — Correct Extraction Errors Before Saving (Priority: P2)

**Goal**: Fields that are null or low-confidence are visually flagged so the admin knows to review them before saving

**Independent Test**: Upload a PDF with a missing invoice number → verify the invoice number field is blank and amber-highlighted → enter a value manually → save successfully

- [X] T015 [P] [US2] Extend `src/app/invoices/new/invoice-upload-form.tsx` to apply amber highlighting (`border-amber-400` Tailwind class) and a shadcn/ui `<Tooltip>` ("Low confidence — please verify") to any form field where the extraction result's `confidence` is `"low"` or the extracted value is `null`; leave `null`-valued inputs empty so the user must supply the value
- [X] T016 [P] [US2] Add inline validation error display to the confirmation form in `src/app/invoices/new/invoice-upload-form.tsx`: use React Hook Form's `formState.errors` to render an error message beneath each required field when blank or invalid on submit attempt; keep the Save button `disabled` while any required field is empty
- [X] T017 [US2] Add duplicate invoice number warning to `src/app/invoices/new/invoice-upload-form.tsx`: after `saveInvoice` returns a success result with a `warning` field, render a shadcn/ui `<Alert variant="warning">` above the submit button reading "An invoice with this number already exists. Saving will create a duplicate."; allow the admin to re-submit or clear the form (depends on T015, T016)

**Checkpoint**: US2 complete — extraction errors and duplicate warnings are surfaced and recoverable

---

## Phase 5: US3 — View and Download Archived Invoices (Priority: P3)

**Goal**: Admins can browse all archived invoices and download the original PDF for any entry

**Independent Test**: Navigate to `/invoices` → verify all saved invoices are listed with correct fields → click Download → verify the original PDF is received

- [X] T018 [P] [US3] Create `src/app/api/invoices/[id]/pdf/route.ts` implementing `GET /api/invoices/[id]/pdf`: call `auth()` and return `401` for non-admin sessions; parse `params.id` as positive integer (return `404` if invalid); query `db.select().from(invoices).where(eq(invoices.id, id))` (return `404` if not found); use `getSignedUrl` with `GetObjectCommand` and `expiresIn: 300` to generate a presigned R2 GET URL (return `500` on failure); return `Response.redirect(presignedUrl, 302)`
- [X] T019 [US3] Extend the table in `src/app/invoices/page.tsx` so each row's Download cell renders `<a href="/api/invoices/[id]/pdf" download>` styled as a shadcn/ui `<Button variant="ghost" size="icon">` with a Lucide `<Download>` icon and `aria-label="Download PDF for invoice [invoiceNumber]"` (depends on T014, T018)

**Checkpoint**: US3 complete — archive list and authenticated PDF download both work independently

---

## Phase 6: Polish

- [X] T020 [P] Add an "Invoices" nav entry to `src/components/app-sidebar.tsx` using a Lucide `FileText` icon, `href: "/invoices"`, and `roles: ["admin"]`, following the existing `NavItem` pattern
- [X] T021 [P] Add empty-state UI to `src/app/invoices/page.tsx`: when the query returns zero rows, render centered text "No invoices archived yet." and a shadcn/ui `<Button asChild>` linking to `/invoices/new` with label "Upload your first invoice"
- [X] T022 [P] Create `src/app/invoices/loading.tsx` as the Suspense skeleton: render a `<Skeleton>` for the heading and three `<Skeleton>` rows matching the table column widths, following the pattern in `src/app/users/loading.tsx`
- [X] T023 [P] Add an ARIA live region to `src/app/invoices/new/invoice-upload-form.tsx`: render `<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">` whose text updates through states: `""` (idle) → `"Uploading PDF…"` → `"Extracting invoice fields…"` → `"Extraction complete. Please review the form."` or `"Extraction failed. Please enter fields manually."`
- [X] T024 Confirm `pnpm typecheck` and `pnpm lint` pass with zero errors and zero warnings across all new and modified files: `src/lib/db/schema.ts`, `src/lib/validators.ts`, `src/lib/invoice-extraction.ts`, `src/types/index.ts`, `src/actions/invoices.ts`, `src/app/api/invoices/upload-token/route.ts`, `src/app/api/invoices/[id]/pdf/route.ts`, `src/app/invoices/page.tsx`, `src/app/invoices/loading.tsx`, `src/app/invoices/new/page.tsx`, `src/app/invoices/new/invoice-upload-form.tsx`, `src/components/app-sidebar.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
  └── Phase 2 (Foundational)          ← packages + env vars must exist before any code runs
        ├── Phase 3 (US1)             ← DB table, Zod schemas, extraction lib must exist
        │     ├── Phase 4 (US2)       ← builds directly on the confirmation form from US1
        │     └── Phase 5 (US3)       ← list page shell from US1; download handler is independent
        └── Phase 6 (Polish)          ← applies across all files from phases 3–5
```

- **Phase 1**: No dependencies — start immediately
- **Phase 2**: Requires Phase 1 completion — **BLOCKS all user stories**
- **Phase 3 (US1)**: Requires Phase 2 completion — MVP scope
- **Phase 4 (US2)** and **Phase 5 (US3)**: Both require Phase 3 — can be worked in parallel
- **Phase 6 (Polish)**: Requires all desired story phases complete

### Within-Phase Dependencies

- **Phase 2**: T004, T005, T006 are parallel; T007 (migration) depends on T004; T008 depends on T005 (uses `invoiceExtractionResultSchema`)
- **Phase 3**: T009 and T010 are parallel; T011 depends on T010 (same file); T012 depends on T010 + T011; T013 is parallel to T012; T014 depends on T004 (schema)

### Parallel Opportunities

Within Phase 2:
```
T004 (schema) ─┐
T005 (Zod)   ─┤→ T007 (migration, needs T004)
T006 (types) ─┘   T008 (extraction lib, needs T005)
```

Within Phase 3:
```
T009 (upload token route) ─┐
T010 (extract action)     ─┤→ T011 (save action) → T012 (client form) → T013, T014
```

Phases 4 and 5 in parallel (after Phase 3):
```
Phase 4: T015, T016 in parallel → T017
Phase 5: T018 in parallel → T019
```

---

## Summary

| Phase | Tasks | User Story | Parallelizable |
|---|---|---|---|
| 1 — Setup | T001–T003 | — | T001–T003 all parallel |
| 2 — Foundational | T004–T008 | — | T004–T006 parallel |
| 3 — US1 (MVP) | T009–T014 | US1 | T009, T010, T013 parallel |
| 4 — US2 | T015–T017 | US2 | T015, T016 parallel |
| 5 — US3 | T018–T019 | US3 | T018 parallel |
| 6 — Polish | T020–T024 | — | T020–T023 parallel |
| **Total** | **24 tasks** | | |

**MVP scope**: Complete Phases 1–3 (T001–T014) to deliver a fully working upload → extract → confirm → save flow.
