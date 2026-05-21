// Orchestration: reads via queries.ts, diffs against the alert-state ledger,
// posts cards, persists state. Called from the cron sync, wrapped in try/catch
// by the caller — alert failures never fail a sync.

import "server-only";

import { format } from "date-fns";
import { env } from "@/lib/env";
import {
  loadCostHistory,
  loadDashboardKpis,
  loadSyncStatus,
  loadWorkspaceList,
} from "@/lib/anthropic/queries";
import {
  forecastWorkspaceMonth,
  type WorkspaceForecast,
} from "@/lib/anthropic/forecast-workspace";
import {
  renderBreachCard,
  renderDigestCard,
  renderForecastCard,
  renderStaleCard,
} from "./cards";
import { postCard } from "./webhook";
import { readAlertState, upsertAlertState } from "./state";
import type {
  AlertDiff,
  AlertStateRow,
  CardEnvelope,
} from "./types";
import type { WorkspaceListItem } from "@/types";

const DIGEST_TOP_N = 5;
const FORECAST_LOOKBACK_DAYS = 30;

type EvaluatorResult = {
  posted: number;
  skipped: string[];
};

export async function evaluateAndPostTeamsAlerts(opts?: {
  now?: Date;
}): Promise<EvaluatorResult> {
  if (!env.TEAMS_WEBHOOK_URL) {
    return { posted: 0, skipped: ["webhook_disabled"] };
  }
  const webhookUrl = env.TEAMS_WEBHOOK_URL;

  const now = opts?.now ?? new Date();
  const month = format(now, "yyyy-MM");
  const dashboardBase =
    env.TEAMS_DASHBOARD_BASE_URL || env.NEXTAUTH_URL || "http://localhost:3000";
  const dashboardUrl = `${dashboardBase.replace(/\/$/, "")}/claude`;

  const sync = await loadSyncStatus();

  if (sync.isStale) {
    await postCard(webhookUrl, renderStaleCard({ sync, month, dashboardUrl }));
    return { posted: 1, skipped: ["digest_skipped_stale"] };
  }

  const [kpis, workspaces, priorState, costHistory] = await Promise.all([
    loadDashboardKpis(month),
    loadWorkspaceList(),
    readAlertState(month),
    loadCostHistory(now, FORECAST_LOOKBACK_DAYS),
  ]);

  // Compute forecasts purely from the pre-loaded cost history (no DB calls).
  const forecastByKey = new Map<string, WorkspaceForecast>();
  for (const w of workspaces) {
    if (w.currentMonthCents === 0 && w.limitCents === null) continue;
    const daily = costHistory.get(w.workspaceId) ?? new Map();
    forecastByKey.set(keyFor(w.workspaceId), forecastWorkspaceMonth(daily, month, now, w.limitCents));
  }

  const workspacesByKey = new Map<string, WorkspaceListItem>();
  for (const w of workspaces) workspacesByKey.set(keyFor(w.workspaceId), w);

  const diff = computeAlertDiff({
    workspaces,
    forecasts: forecastByKey,
    priorState,
    month,
    now,
  });

  const envelopes: CardEnvelope[] = [];

  envelopes.push(
    renderDigestCard({
      kpis,
      topWorkspaces: workspaces.slice(0, DIGEST_TOP_N),
      sync,
      month,
      dashboardUrl,
    }),
  );

  for (const fire of diff.thresholdsToFire) {
    const workspace = workspacesByKey.get(keyFor(fire.workspaceId));
    if (!workspace) continue;
    const workspaceUrl = workspaceUrlFor(dashboardBase, workspace.workspaceId);
    envelopes.push(
      renderBreachCard({
        workspace,
        threshold: fire.threshold,
        forecast: forecastByKey.get(keyFor(workspace.workspaceId)) ?? null,
        workspaceUrl,
        raiseLimitUrl: `${workspaceUrl}#limit`,
      }),
    );
  }

  // Recovery cards deferred per spec Q1; only post when entering at_risk.
  for (const edge of diff.forecastEdges) {
    if (!edge.nextValue) continue;
    const workspace = workspacesByKey.get(keyFor(edge.workspaceId));
    const forecast = forecastByKey.get(keyFor(edge.workspaceId));
    if (!workspace || !forecast) continue;
    envelopes.push(
      renderForecastCard({
        workspace,
        forecast,
        workspaceUrl: workspaceUrlFor(dashboardBase, workspace.workspaceId),
      }),
    );
  }

  // Post serially to stay under the per-webhook 4 req/sec throttle. If any
  // POST throws, the whole batch fails and state is not persisted — next sync
  // re-evaluates from the same prior state and re-attempts. Cards already
  // delivered will appear again (duplicate in channel), which is the
  // acceptable cost of all-or-nothing batch semantics.
  for (const envelope of envelopes) {
    await postCard(webhookUrl, envelope);
  }

  await upsertAlertState(diff.rowsToUpsert);

  return { posted: envelopes.length, skipped: [] };
}

// Pure diff computation — exported for tests.
export function computeAlertDiff(input: {
  workspaces: WorkspaceListItem[];
  forecasts: Map<string, WorkspaceForecast>;
  priorState: AlertStateRow[];
  month: string;
  now: Date;
}): AlertDiff {
  const { workspaces, forecasts, priorState, month, now } = input;

  const stateByKey = new Map<string, AlertStateRow>();
  for (const r of priorState) stateByKey.set(keyFor(r.workspaceId), r);

  const thresholdsToFire: AlertDiff["thresholdsToFire"] = [];
  const forecastEdges: AlertDiff["forecastEdges"] = [];
  const rowsToUpsert: AlertStateRow[] = [];

  for (const w of workspaces) {
    if (w.isArchived) continue;

    const key = keyFor(w.workspaceId);
    const prior = stateByKey.get(key);
    const forecast = forecasts.get(key);

    const pct = w.utilizationPct ?? 0;
    const limited = w.limitCents !== null && w.limitCents > 0;

    let t80 = prior?.threshold80FiredAt ?? null;
    let t100 = prior?.threshold100FiredAt ?? null;
    let t120 = prior?.threshold120FiredAt ?? null;

    if (limited) {
      if (t80 === null && pct >= 80) {
        t80 = now;
        thresholdsToFire.push({ workspaceId: w.workspaceId, threshold: "threshold_80" });
      }
      if (t100 === null && pct >= 100) {
        t100 = now;
        thresholdsToFire.push({ workspaceId: w.workspaceId, threshold: "threshold_100" });
      }
      if (t120 === null && pct >= 120) {
        t120 = now;
        thresholdsToFire.push({ workspaceId: w.workspaceId, threshold: "threshold_120" });
      }
    }

    // `insufficient_data` is treated as on_track so we don't emit cards for
    // noisy / new workspaces.
    const nextAtRisk = forecast?.status === "at_risk";
    const wasAtRisk = prior?.forecastAtRisk ?? false;
    let forecastChangedAt = prior?.forecastChangedAt ?? null;
    if (nextAtRisk !== wasAtRisk) {
      forecastChangedAt = now;
      forecastEdges.push({ workspaceId: w.workspaceId, nextValue: nextAtRisk });
    }

    const changed =
      t80 !== (prior?.threshold80FiredAt ?? null) ||
      t100 !== (prior?.threshold100FiredAt ?? null) ||
      t120 !== (prior?.threshold120FiredAt ?? null) ||
      nextAtRisk !== wasAtRisk;
    if (!changed) continue;

    rowsToUpsert.push({
      workspaceId: w.workspaceId,
      billingMonth: month,
      threshold80FiredAt: t80,
      threshold100FiredAt: t100,
      threshold120FiredAt: t120,
      forecastAtRisk: nextAtRisk,
      forecastChangedAt,
    });
  }

  return { thresholdsToFire, forecastEdges, rowsToUpsert };
}

// `"__default__"` is in-memory only — never persisted, never sent to SQL.
// Real Anthropic workspace ids are UUIDs, so collision is impossible.
function keyFor(workspaceId: string | null): string {
  return workspaceId ?? "__default__";
}

function workspaceUrlFor(base: string, workspaceId: string | null): string {
  const root = base.replace(/\/$/, "");
  if (workspaceId === null) return `${root}/claude`;
  return `${root}/claude/workspaces/${encodeURIComponent(workspaceId)}`;
}
