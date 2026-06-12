// Ingestion display helpers (034-ingestion-types-distinction)
//
// Pure, dependency-light helpers shared by the server (logger writes the
// headline into ingestion_log.label) and the client (registry / table). No
// React, no "server-only" — safe to import from either side.

import { formatCurrency } from "@/lib/utils";
import type { IngestionDetails, IngestionKind } from "@/types";

// Human-readable name for each kind. Plain strings (no icons) so this stays
// importable from server code.
export const INGESTION_KIND_LABELS: Record<IngestionKind, string> = {
  invoice: "Invoice",
  license_request: "License request",
  user_import: "User import",
  other: "Other",
};

/**
 * Build the one-line headline stored in `ingestion_log.label` and shown in the
 * history table's Summary column and the activity feed. Derived from the typed
 * details payload so every surface reads the same string.
 */
export function buildIngestionLabel(details: IngestionDetails): string {
  switch (details.kind) {
    case "invoice": {
      const parts: string[] = [];
      if (details.vendor) parts.push(details.vendor);
      if (details.amountCents != null)
        parts.push(formatCurrency(details.amountCents));
      if (parts.length > 0) return parts.join(" · ");
      return details.invoiceNumber ?? details.filename ?? "Invoice";
    }
    case "license_request": {
      const who = details.requesterName ?? details.requesterEmail ?? "Unknown";
      const tool = details.toolName ?? "tool";
      const base = `${who} → ${tool}`;
      return details.deduped ? `${base} (duplicate)` : base;
    }
    case "user_import":
      return `${details.rowCount} rows · +${details.created} / ~${details.updated}`;
    case "other":
      return details.description ?? "Ingestion";
  }
}
