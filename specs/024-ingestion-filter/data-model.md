# Data Model: Invoice Ingestion Filters

**Branch**: `024-ingestion-filter` | **Date**: 2026-03-27

## New Enums

### `filter_field`
| Value | Description |
|-------|-------------|
| `vendor` | Match against extracted vendor name |
| `invoice_number` | Match against extracted invoice number |

### `filter_mode`
| Value | Description |
|-------|-------------|
| `whitelist` | Only matching invoices proceed to budget linking |
| `blacklist` | Matching invoices are blocked from budget linking |

### Extended: `ingestion_outcome`
| Value | Status |
|-------|--------|
| `success` | Existing |
| `failed` | Existing |
| `filtered` | **NEW** — invoice stored but excluded from budget linking |

## New Table: `ingestion_filters`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | serial | NO | auto | Primary key |
| `name` | varchar(255) | NO | — | Human-readable rule name |
| `field` | filter_field | NO | — | Which invoice field to match |
| `mode` | filter_mode | NO | — | Whitelist or blacklist |
| `value` | jsonb | NO | — | Field-specific match config (see below) |
| `enabled` | boolean | NO | `true` | Toggle without deleting |
| `priority` | integer | NO | `0` | Evaluation order (lower = first) |
| `created_by` | integer (FK → users.id) | NO | — | Audit: who created |
| `created_at` | timestamp | NO | `now()` | Audit: when created |
| `updated_at` | timestamp | NO | `now()` | Audit: when last modified |

**Indexes**:
- `ingestion_filters_enabled_idx` on (`enabled`)

### Value JSONB Shapes

**When `field = 'vendor'`**:
```json
{
  "values": ["Anthropic", "OpenAI"]
}
```
- `values`: array of 1+ strings, each 1–255 chars
- Matching: case-insensitive substring against extracted vendor

**When `field = 'invoice_number'`**:
```json
{
  "pattern": "^TEST-.*"
}
```
- `pattern`: regex string, 1–500 chars, must be valid JavaScript RegExp
- Matching: case-insensitive regex test against extracted invoice number

## Modified Table: `invoices`

| Column | Change | Type | Default | Description |
|--------|--------|------|---------|-------------|
| `filtered_out` | **ADD** | boolean | `false` | Whether invoice was excluded by a filter rule |

No index needed — queried via existing `createdAt` ordering; `filtered_out` is low-cardinality.

## Entity Relationships

```
ingestion_filters.created_by → users.id (FK, ON DELETE no action)

invoices.filtered_out (new column, no FK)

ingestion_log.outcome (extended enum: + "filtered")
```

## State Transitions

### Ingestion Filter Lifecycle
```
Created (enabled=true) → Disabled (enabled=false) → Re-enabled (enabled=true) → Deleted
```
- No soft-delete — hard delete only
- Enable/disable is a simple boolean toggle
- Changes affect future ingestions only

### Invoice Filter State
```
Ingested → [Filter Evaluation] → Budget-Linked (filtered_out=false)
                                → Filtered (filtered_out=false → true)
```
- `filtered_out` is set once at ingestion time and never changed retroactively
- A filtered invoice has `linkedBilledCostId = NULL` and `filtered_out = true`
- An unlinked-but-not-filtered invoice has `linkedBilledCostId = NULL` and `filtered_out = false` (e.g., no matching budget period)

## Validation Rules

| Entity | Rule |
|--------|------|
| ingestion_filters.name | 1–255 chars, required |
| ingestion_filters.value (vendor) | `values` array: 1+ items, each 1–255 chars |
| ingestion_filters.value (invoice_number) | `pattern`: 1–500 chars, valid RegExp |
| ingestion_filters.priority | integer ≥ 0 |
| invoices.filtered_out | boolean, default false, set by filter engine only |
