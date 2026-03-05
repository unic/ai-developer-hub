# Quickstart: Invoice PDF Upload & Auto-Processing

**Feature**: `006-invoice-pdf-upload`
**For**: New contributors or anyone setting up this feature locally

---

## Prerequisites

- Node.js LTS installed
- `pnpm` installed globally
- Cloudflare account with R2 enabled (free tier is sufficient)
- Anthropic API key (for Claude Haiku extraction)

---

## 1. Install new dependencies

```bash
pnpm add unpdf @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @anthropic-ai/sdk
```

> `@anthropic-ai/sdk` may already be installed — check `package.json` first.

---

## 2. Environment variables

Add the following to your `.env.local`:

```env
# Existing
DATABASE_URL=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# New for this feature
CLOUDFLARE_R2_ACCOUNT_ID=<your-account-id>
CLOUDFLARE_R2_ACCESS_KEY_ID=<r2-api-token-access-key>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2-api-token-secret>
CLOUDFLARE_R2_BUCKET_NAME=invoice-pdfs
ANTHROPIC_API_KEY=sk-ant-...
```

Add the same variables to your Vercel project under **Settings → Environment Variables**.

---

## 3. Apply the DB migration

```bash
pnpm db:generate   # generates migration for the new `invoices` table
pnpm db:migrate    # applies it to your Neon dev DB
```

Verify the table exists:
```bash
pnpm db:push       # alternative: push schema directly (dev only)
```

---

## 4. Create a Cloudflare R2 bucket (first time only)

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Click **Create bucket** → name it `invoice-pdfs` → **Create bucket**
3. Go to **R2 → Manage R2 API Tokens** → **Create API Token**
   - Permissions: **Object Read & Write**
   - Scope: **Specific bucket** → `invoice-pdfs`
4. Copy the **Access Key ID**, **Secret Access Key**, and your **Account ID** (top-right of the R2 page) into `.env.local`

---

## 5. Start the dev server

```bash
pnpm dev
```

Navigate to `http://localhost:3000/invoices` — you should see the invoice archive (empty).
Navigate to `http://localhost:3000/invoices/new` — you should see the upload form.

---

## 6. Test the upload flow

1. Log in as an admin user
2. Go to `/invoices/new`
3. Select a PDF invoice file
4. Wait for extraction (1–3 seconds)
5. Verify pre-filled fields; correct any errors
6. Click **Save to Archive**
7. Verify the invoice appears at `/invoices`
8. Click the download icon to retrieve the original PDF

---

## 7. Run tests

```bash
pnpm test                  # unit tests (includes extraction logic)
pnpm test:integration      # integration tests (DB write/read)
pnpm test:e2e              # Playwright E2E (upload flow)
```

---

## Key files for this feature

| File | Purpose |
|---|---|
| `src/lib/db/schema.ts` | `invoices` table definition |
| `src/lib/validators.ts` | `createInvoiceSchema`, `invoiceExtractionResultSchema` |
| `src/lib/invoice-extraction.ts` | `unpdf` + Claude Haiku extraction logic |
| `src/actions/invoices.ts` | `extractInvoiceFields`, `saveInvoice` Server Actions |
| `src/app/invoices/page.tsx` | Invoice archive list (Server Component) |
| `src/app/invoices/new/page.tsx` | Upload page |
| `src/app/invoices/new/invoice-upload-form.tsx` | Client Component (upload + confirmation form) |
| `src/app/api/invoices/upload-url/route.ts` | R2 presigned PUT URL generator |
| `src/app/api/invoices/[id]/pdf/route.ts` | Authenticated PDF download proxy |
