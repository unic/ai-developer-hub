// Ingestion-type registry (034-ingestion-types-distinction)
//
// Single source of per-kind UI behaviour. Every ingestion surface — the
// history table, sub-tabs, and (later) the activity feed — reads from this map
// so adding a new ingestion type is a registry entry, not edits scattered
// across components. Pairs with `labels.ts` (server-safe headline strings).

import {
  FileText,
  UserPlus,
  Upload,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { INGESTION_KIND_LABELS } from "@/lib/ingestion/labels";
import type { IngestionKind } from "@/types";
import type { IngestionLogRow } from "@/actions/ingestion-log";

export interface IngestionTypeDef {
  /** Human-readable kind name (from labels.ts). */
  label: string;
  /** Monoline icon — inherits text colour, never filled. */
  icon: LucideIcon;
  /** Drill-through href for a row, or null when there's nothing to open. */
  drillThrough: (row: IngestionLogRow) => string | null;
  /** Tooltip / aria label for the drill-through control. */
  drillLabel: string;
  /** Whether the drill-through opens in a new tab (downloads / external). */
  drillNewTab: boolean;
}

export const INGESTION_TYPES: Record<IngestionKind, IngestionTypeDef> = {
  invoice: {
    label: INGESTION_KIND_LABELS.invoice,
    icon: FileText,
    drillThrough: (row) =>
      row.entityType === "invoice" && row.entityId
        ? `/api/invoices/${row.entityId}/pdf`
        : null,
    drillLabel: "Download document",
    drillNewTab: true,
  },
  license_request: {
    label: INGESTION_KIND_LABELS.license_request,
    icon: UserPlus,
    drillThrough: (row) =>
      row.entityType === "license_request" && row.entityId
        ? `/requests/${row.entityId}`
        : null,
    drillLabel: "Open request",
    drillNewTab: false,
  },
  user_import: {
    // Reserved (Q4) — not wired into any writer yet.
    label: INGESTION_KIND_LABELS.user_import,
    icon: Upload,
    drillThrough: () => null,
    drillLabel: "",
    drillNewTab: false,
  },
  other: {
    label: INGESTION_KIND_LABELS.other,
    icon: Inbox,
    drillThrough: () => null,
    drillLabel: "",
    drillNewTab: false,
  },
};

/** Kinds that have at least one row in the data, for building the sub-tabs. */
export function presentKinds(rows: IngestionLogRow[]): IngestionKind[] {
  const seen = new Set<IngestionKind>();
  for (const r of rows) seen.add(r.kind);
  return (Object.keys(INGESTION_TYPES) as IngestionKind[]).filter((k) =>
    seen.has(k),
  );
}
