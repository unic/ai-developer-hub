// Shared types for the Teams alerts module.
// Pure types — safe to import from server-only and (theoretically) client code.

import type {
  DashboardKpis,
  SyncStatus,
  WorkspaceListItem,
} from "@/types";
import type { WorkspaceForecast } from "@/lib/anthropic/forecast-workspace";

// ---------------------------------------------------------------------------
// Adaptive Card envelope per Workflows webhook contract.
// ---------------------------------------------------------------------------

export type AdaptiveCard = {
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json";
  type: "AdaptiveCard";
  version: "1.4";
  body: unknown[];
  actions?: unknown[];
};

export type CardEnvelope = {
  type: "message";
  attachments: Array<{
    contentType: "application/vnd.microsoft.card.adaptive";
    contentUrl: null;
    content: AdaptiveCard;
  }>;
};

// ---------------------------------------------------------------------------
// Card-input shapes — what the evaluator passes to each renderer.
// ---------------------------------------------------------------------------

export type DigestInput = {
  kpis: DashboardKpis;
  topWorkspaces: WorkspaceListItem[];
  sync: SyncStatus;
  month: string; // "YYYY-MM"
  dashboardUrl: string;
};

export type ThresholdKey = "threshold_80" | "threshold_100" | "threshold_120";

export type BreachInput = {
  workspace: WorkspaceListItem;
  threshold: ThresholdKey;
  forecast: WorkspaceForecast | null;
  workspaceUrl: string;
  raiseLimitUrl: string;
};

export type ForecastInput = {
  workspace: WorkspaceListItem;
  forecast: WorkspaceForecast;
  workspaceUrl: string;
};

export type StaleInput = {
  sync: SyncStatus;
  month: string;
  dashboardUrl: string;
};

// ---------------------------------------------------------------------------
// State-machine output produced by the evaluator.
// ---------------------------------------------------------------------------

export type AlertStateRow = {
  workspaceId: string | null;
  billingMonth: string;
  threshold80FiredAt: Date | null;
  threshold100FiredAt: Date | null;
  threshold120FiredAt: Date | null;
  forecastAtRisk: boolean;
  forecastChangedAt: Date | null;
};

export type ThresholdToFire = {
  workspaceId: string | null;
  threshold: ThresholdKey;
};

export type ForecastEdge = {
  workspaceId: string | null;
  nextValue: boolean; // true = entered at_risk, false = recovered
};

export type AlertDiff = {
  thresholdsToFire: ThresholdToFire[];
  forecastEdges: ForecastEdge[];
  // Final row state per workspace, ready to upsert.
  rowsToUpsert: AlertStateRow[];
};
