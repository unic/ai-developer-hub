# Implementation Plan: Invoice PDF Upload & Auto-Processing

**Branch**: `006-invoice-pdf-upload` | **Date**: 2026-03-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-invoice-pdf-upload/spec.md`

---

## Summary

Adds an invoice archive to the AI Developer Hub: admins upload a PDF invoice, Claude Haiku automatically extracts the invoice number, date, and total amount, the admin reviews and confirms the pre-filled form, and the record (plus the original PDF) is saved permanently. The PDF binary is stored in Cloudflare R2 (private bucket, presigned PUT URL for direct browser upload to bypass the 4.5 MB Function limit); metadata is stored in a new standalone `invoices` table in Neon. Downloads use a short-lived R2 presigned GET URL. Extraction uses `unpdf` for PDF text parsing and `claude-haiku-4-5` with forced tool use for structured field extraction, falling back to regex heuristics on API failure.

---

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**:
- `unpdf` v1.4.x — PDF text extraction (serverless-safe, zero config for Vercel)
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — Cloudflare R2 (S3-compatible) file storage
- `@anthropic-ai/sdk` — Claude Haiku extraction via forced tool use
- Existing: Next.js 15.5.12, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui, Zod 4.3.6, sonner (toasts)

**Storage**:
- Neon PostgreSQL (serverless) — new `invoices` table for metadata
- Cloudflare R2 (private bucket, S3-compatible) — PDF binary storage; object key stored in Neon

**Testing**: Vitest (unit + integration), Playwright (E2E)
**Target Platform**: Vercel serverless (Node.js runtime — not Edge)
**Performance Goals**: Full upload-to-archive flow ≤ 60 seconds; invoice list page LCP < 2.5s
**Constraints**: Vercel Function body limit 4.5 MB → presigned PUT URL upload required; Cloudflare R2 free tier: 10 GB storage + 1M Class A ops/month (sufficient for hundreds of invoices)
**Scale/Scope**: ~100–500 invoices/year; standalone feature, no integration with budget_periods

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Type-Safe Code Quality | ✅ Pass | TypeScript strict throughout; Zod validates all inputs server and client; ESLint/Prettier enforced |
| II. UX Consistency | ✅ Pass | shadcn/ui components (Card, Input, Button, Table, Badge); design tokens only; loading/error/empty states per component |
| III. Performance Budgets | ✅ Pass | Invoice list is a simple server-rendered table; no heavy client JS; PDF upload is a user-initiated action (latency expected); AWS SDK adds ~40 KB gzipped but is tree-shakeable and only loaded on upload/download paths |
| IV. Accessibility-First | ✅ Pass | File input has visible label; upload progress announced via ARIA live region; form fields have associated labels; keyboard-navigable confirmation form |
| V. Simplicity & Maintainability | ✅ Pass | One new table, one extraction utility, two Route Handlers, two Server Actions; no repository pattern or speculative abstraction |

**Post-design re-check**: ✅ No violations introduced by Phase 1 design. The presigned URL upload pattern adds one Route Handler but eliminates the 4.5 MB Function body limit failure class. The standalone `invoices` table avoids making `periodId` nullable in `billed_costs`.

**Complexity Tracking**: No violations — table omitted.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-invoice-pdf-upload/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — library and approach decisions
├── data-model.md        # Phase 1 — invoices table + Zod schemas
├── quickstart.md        # Phase 1 — local dev setup guide
├── contracts/
│   └── api-routes.md    # Phase 1 — Route Handler + Server Action contracts
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/
├── actions/
│   └── invoices.ts                        # extractInvoiceFields, saveInvoice Server Actions
│
├── app/
│   ├── invoices/
│   │   ├── page.tsx                       # Invoice archive list (Server Component)
│   │   ├── loading.tsx                    # Skeleton loader
│   │   └── new/
│   │       ├── page.tsx                   # Upload page wrapper
│   │       └── invoice-upload-form.tsx    # Client Component: file input + confirmation form
│   └── api/
│       └── invoices/
│           ├── upload-url/
│           │   └── route.ts               # R2 presigned PUT URL generator
│           └── [id]/
│               └── pdf/
│                   └── route.ts           # Authenticated PDF download proxy
│
└── lib/
    ├── db/
    │   └── schema.ts                      # + invoices table + invoicesRelations
    ├── validators.ts                      # + createInvoiceSchema, invoiceExtractionResultSchema
    ├── invoice-extraction.ts              # unpdf + Claude Haiku extraction (+ regex fallback)
    └── utils.ts                           # (no changes — uses existing formatCurrency, formatDate)

tests/
├── unit/
│   └── invoice-extraction.test.ts        # Unit tests for extraction logic
└── integration/
    └── invoices.test.ts                   # DB write/read integration tests
```

**Structure Decision**: Single Next.js project (App Router). Follows the existing `src/actions/`, `src/app/`, `src/lib/` layout. No new directories introduced beyond the `invoices/` route group and `api/invoices/` handlers.

---

## Upload & Extraction Flow

```
1. Admin navigates to /invoices/new
2. Selects a PDF file (client-side MIME type check: application/pdf only)
3. Client calls POST /api/invoices/upload-url  ← server generates R2 presigned PUT URL + objectKey
4. Client PUT-uploads PDF directly to R2 using the presigned URL (bypasses 4.5 MB Function limit)
5. Client receives { objectKey } back from the upload-url route
6. Client calls Server Action extractInvoiceFields({ objectKey })
   a. Server fetches PDF bytes from R2 using GetObjectCommand
   b. Extracts text with unpdf (mergePages: true)
   c. If text < 50 chars → return { success: false, error: "PDF has no readable text layer" }
   d. Calls claude-haiku-4-5 with forced tool use
   e. On API error/timeout → regex fallback, confidence: "low" for all fields
   f. Zod validates result
7. Client pre-fills confirmation form:
   - null field → empty input, amber highlight
   - confidence "low" → amber highlight + tooltip "Low confidence — please verify"
   - all high/medium → green checkmark
8. Admin reviews, corrects any fields, clicks Save
9. Client calls Server Action saveInvoice(input)
    a. requireAdmin() check
    b. createInvoiceSchema.safeParse(input)
    c. Duplicate invoice_number soft check → warning if exists
    d. db.insert(invoices) + recordCreation("invoice", id, adminId)
    e. On DB failure → DeleteObjectCommand(objectKey) (orphan cleanup) + return error
    f. revalidatePath("/invoices")
10. Client shows success toast, redirects to /invoices

Download flow:
GET /api/invoices/[id]/pdf
  → auth check
  → fetch objectKey from Neon
  → GetPresignedUrl (GetObjectCommand, expires 5 min)
  → redirect 302 to presigned URL
```

---

## New Environment Variables

| Variable | Source | Purpose |
|---|---|---|
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare dashboard → R2 | Constructs the R2 endpoint URL |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Cloudflare R2 API token | S3-compatible auth |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token | S3-compatible auth |
| `CLOUDFLARE_R2_BUCKET_NAME` | Cloudflare R2 bucket name | Target bucket for invoice PDFs |
| `ANTHROPIC_API_KEY` | Anthropic console | Claude Haiku extraction calls |

All must be added to Vercel project environment variables (production + preview) and to `.env.local` for local development.

---

## New Dependencies

| Package | Version | Purpose |
|---|---|---|
| `unpdf` | `^1.4.0` | PDF text extraction (serverless-safe, wraps pdfjs-dist v5) |
| `@aws-sdk/client-s3` | `^3.x` | S3-compatible client for Cloudflare R2 (upload, download, delete) |
| `@aws-sdk/s3-request-presigner` | `^3.x` | Generates presigned PUT (upload) and GET (download) URLs |

> `@anthropic-ai/sdk` — check if already in `package.json`; add only if absent.
