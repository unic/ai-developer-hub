// Ingestion type system (034-ingestion-types-distinction)
//
// The ingestion_log table is discriminated by `kind`. Type-specific fields
// live in the JSONB `details` payload, modelled here as a discriminated union
// so call sites and the UI registry get exhaustive, compile-time-checked
// access. These are plain string-literal unions (not derived from the Drizzle
// pgEnums) to avoid a runtime import cycle with the schema module — the values
// are kept in lockstep with `ingestionKindEnum` / `ingestionSourceTypeEnum`.

export type IngestionKind =
  | "invoice"
  | "license_request"
  | "user_import"
  | "other";

export type IngestionSourceType =
  | "invoice_pdf"
  | "ms_forms_license_request"
  | "csv_user_import";

export type IngestionOutcome = "success" | "failed" | "filtered";

export type IngestionChannel = "manual" | "api" | "bulk";

// Invoice / document ingestion — adds to budget / expenses.
export interface InvoiceIngestionDetails {
  kind: "invoice";
  vendor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amountCents?: number | null;
  filename?: string | null;
  blobPathname?: string | null;
  /** Name of the filter rule that matched, when the outcome is "filtered". */
  filterRuleName?: string | null;
}

// License-request ingestion — a person requesting tool access (MS Forms).
// Requester fields are optional because early-failure logging (invalid JSON,
// schema rejection) happens before the payload is known.
export interface LicenseRequestIngestionDetails {
  kind: "license_request";
  formResponseId?: string | null;
  requesterEmail?: string | null;
  requesterName?: string | null;
  /** Derived tool (032-v2) or requested tool (v1); null = needs decision. */
  toolName?: string | null;
  tierName?: string | null;
  /** v2 contract inputs; null on legacy v1 rows. */
  role?: string | null;
  profile?: string | null;
  /** True when this was an idempotent replay of an already-seen form response. */
  deduped: boolean;
}

// Bulk user import — reserved (Q4), not yet wired.
export interface UserImportIngestionDetails {
  kind: "user_import";
  rowCount: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

// Forward-compat escape hatch for ingestions that don't fit a known kind.
// Keeps the details union aligned with the `ingestion_kind` enum + registry.
export interface OtherIngestionDetails {
  kind: "other";
  description?: string | null;
}

export type IngestionDetails =
  | InvoiceIngestionDetails
  | LicenseRequestIngestionDetails
  | UserImportIngestionDetails
  | OtherIngestionDetails;
