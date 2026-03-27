# Research: Invoice Ingestion Filters

**Branch**: `024-ingestion-filter` | **Date**: 2026-03-27

## R1: Filter Evaluation Insertion Points

**Decision**: Two integration points — the API ingest route and the `saveInvoice` server action.

**Rationale**: The codebase has two distinct paths that create invoices and link them to budget periods:

1. **API route** (`src/app/api/invoices/ingest/route.ts`, line 172–216): Extracts fields, looks up budget period via `findPeriodForDate()`, then runs a transaction that inserts `billedCosts` + `invoices` together. Filter check inserts after extraction (line 111) and before the period lookup (line 172).

2. **`saveInvoice` action** (`src/actions/invoices.ts`, lines 385–409): Inserts the invoice first, then calls `findActivePeriodForDate()` and `insertBilledCostDirect()` to auto-link. Filter check inserts after the invoice DB insert (line 368) and before the period lookup (line 385). This path also serves bulk uploads via `saveBulkInvoices()`.

**Alternatives considered**:
- Shared middleware/wrapper: Rejected — the two paths have different transaction structures, making a generic wrapper more complex than inline checks.
- Pre-extraction filter: Rejected — vendor/invoice number aren't known before extraction.

## R2: Enum Extension Strategy

**Decision**: Use idempotent `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` blocks for new enums and `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for extending the existing `ingestion_outcome` enum.

**Rationale**: The migration at `0015_add_ingestion_log.sql` demonstrates this exact idempotent pattern. Adding a value to an existing PostgreSQL enum requires `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction block in older PostgreSQL versions. Neon PostgreSQL supports `ADD VALUE IF NOT EXISTS` for safe idempotent migrations.

**Alternatives considered**:
- Drop and recreate enum: Rejected — dangerous in production, requires column type changes.
- Use varchar instead of enum: Rejected — enum provides type safety and is consistent with existing pattern.

## R3: Filter Rule Storage Format

**Decision**: Use a `jsonb` column for the filter value, with Zod validation enforcing field-specific shapes at the application layer.

**Rationale**: The two filter fields have different value structures:
- **vendor**: `{ values: string[] }` — list of substring patterns
- **invoice_number**: `{ pattern: string }` — regex pattern

A jsonb column with application-level Zod validation is simpler than separate columns or a polymorphic table design. The codebase already uses jsonb in other tables (e.g., usage metrics).

**Alternatives considered**:
- Separate value columns per field type: Rejected — adds nullable columns and complexity.
- EAV (entity-attribute-value) pattern: Rejected — over-engineering for 2 field types.

## R4: Whitelist OR Logic Across Fields

**Decision**: Whitelist rules use OR logic across fields — an invoice passes if it matches ANY field's whitelist.

**Rationale**: Per clarification session (2026-03-27). This is the looser interpretation, meaning an invoice whitelisted by vendor doesn't also need to match an invoice number whitelist. Simpler for admins to reason about.

**Implementation**: Group whitelist rules by field. For each field that has whitelist rules, check if the invoice matches. If it matches any one field's whitelist, it passes. Only filter out if whitelist rules exist and the invoice matches none of them across all fields.

## R5: Ingestion Logger Extension

**Decision**: Extend the existing `LogIngestionParams.outcome` type to include `"filtered"` and use the existing `errorMessage` field to store the filter reason (matched rule name).

**Rationale**: The ingestion logger (`src/lib/ingestion-logger.ts`) already has a `LogIngestionParams` interface with `outcome: "success" | "failed"` and an optional `errorMessage: string | null`. Reusing `errorMessage` for the filter reason avoids schema changes to `ingestionLog` beyond the enum extension. The UI already renders this field via `ErrorPopover`.

**Alternatives considered**:
- New `metadata` jsonb column on ingestionLog: Rejected — over-engineering when errorMessage suffices.
- Separate filter_log table: Rejected — duplicates ingestionLog functionality.

## R6: Regex Safety

**Decision**: Validate regex patterns at creation time with try-catch around `new RegExp()`, and enforce a maximum pattern length of 500 characters.

**Rationale**: User-supplied regex could cause ReDoS (Regular Expression Denial of Service). A length limit plus try-catch validation at rule creation time catches syntax errors and limits complexity. At evaluation time, the pattern is applied against short strings (invoice numbers, typically < 50 chars), so the attack surface is minimal.

**Alternatives considered**:
- Execution timeout wrapper: Rejected — overly complex for the threat model.
- Glob-only matching (no regex): Rejected — regex is more powerful and the spec calls for it.
