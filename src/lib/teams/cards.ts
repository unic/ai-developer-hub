// Pure functions: (input) => CardEnvelope. No DB, no env, no clock.
// Snapshot-testable. See cards.test.ts for examples.

import type {
  AdaptiveCard,
  BreachInput,
  CardEnvelope,
  DigestInput,
  ForecastInput,
  StaleInput,
} from "./types";
import { fmtAgo, fmtDeltaPct, fmtMoney, fmtPct } from "./format";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Envelope helper — wraps an AdaptiveCard in the Workflows webhook envelope.
// ---------------------------------------------------------------------------

function envelope(card: AdaptiveCard): CardEnvelope {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };
}

function projectedEomLabel(projectedCents: number, limitCents: number | null): string {
  if (limitCents === null) return fmtMoney(projectedCents);
  if (projectedCents > limitCents) {
    return `${fmtMoney(projectedCents)} · +${fmtMoney(projectedCents - limitCents)} over`;
  }
  return `${fmtMoney(projectedCents)} · within cap`;
}

// Adaptive Cards' Image element doesn't support SVG in Teams, so utilization
// bars are nested ColumnSets with tinted Container backgrounds.
function utilizationBar(pct: number): unknown {
  const filled = Math.min(100, Math.max(0, pct));
  const remaining = Math.max(0, 100 - filled);
  const style = pct >= 100 ? "attention" : pct >= 80 ? "warning" : "good";
  const columns: unknown[] = [];
  if (filled > 0) {
    columns.push({
      type: "Column",
      width: filled,
      items: [
        {
          type: "Container",
          style,
          minHeight: "6px",
          items: [{ type: "TextBlock", text: " ", spacing: "None" }],
        },
      ],
    });
  }
  if (remaining > 0) {
    columns.push({
      type: "Column",
      width: remaining,
      items: [
        {
          type: "Container",
          style: "default",
          minHeight: "6px",
          items: [{ type: "TextBlock", text: " ", spacing: "None" }],
        },
      ],
    });
  }
  return { type: "ColumnSet", spacing: "None", columns };
}

// ---------------------------------------------------------------------------
// 1) Hourly digest
// ---------------------------------------------------------------------------

export function renderDigestCard(input: DigestInput): CardEnvelope {
  const { kpis, topWorkspaces, sync, month, dashboardUrl } = input;

  const kpiBlock = {
    type: "ColumnSet",
    spacing: "Medium",
    columns: [
      {
        type: "Column",
        width: "stretch",
        items: [
          { type: "TextBlock", text: "MTD spend", isSubtle: true, size: "Small" },
          {
            type: "TextBlock",
            text: fmtMoney(kpis.totalCents),
            weight: "Bolder",
            size: "ExtraLarge",
            spacing: "None",
          },
          {
            type: "TextBlock",
            text: `${fmtDeltaPct(kpis.momDeltaPct)} vs last month`,
            color: (kpis.momDeltaPct ?? 0) > 0 ? "Attention" : "Default",
            size: "Small",
            spacing: "None",
          },
        ],
      },
      {
        type: "Column",
        width: "stretch",
        items: [
          { type: "TextBlock", text: "Workspaces > 80%", isSubtle: true, size: "Small" },
          {
            type: "TextBlock",
            text: `${kpis.workspacesOverEightyCount} of ${kpis.workspacesWithLimitCount}`,
            weight: "Bolder",
            size: "ExtraLarge",
            spacing: "None",
          },
        ],
      },
      {
        type: "Column",
        width: "stretch",
        items: [
          { type: "TextBlock", text: "Projected EOM", isSubtle: true, size: "Small" },
          {
            type: "TextBlock",
            text: fmtMoney(kpis.projectedMonthEndCents),
            weight: "Bolder",
            size: "ExtraLarge",
            spacing: "None",
          },
        ],
      },
    ],
  };

  const wsItems: unknown[] = [];
  for (const w of topWorkspaces) {
    const pctText =
      w.utilizationPct !== null
        ? `${fmtPct(w.utilizationPct)} · ${fmtMoney(w.currentMonthCents)} / ${fmtMoney(w.limitCents ?? 0)}`
        : `${fmtMoney(w.currentMonthCents)} · no limit`;
    wsItems.push({
      type: "TextBlock",
      text: `**${w.name}** · ${pctText}`,
      spacing: "Small",
      wrap: true,
    });
    if (w.utilizationPct !== null) {
      wsItems.push(utilizationBar(w.utilizationPct));
    }
  }

  const card: AdaptiveCard = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: "Claude API spend · hourly digest",
        weight: "Bolder",
        size: "Large",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: `${month} MTD · data is ${fmtAgo(sync.ageMinutes)}`,
        isSubtle: true,
        spacing: "None",
        wrap: true,
      },
      kpiBlock,
      {
        type: "TextBlock",
        text: "Top utilization",
        weight: "Bolder",
        spacing: "Medium",
      },
      ...wsItems,
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Open dashboard", url: dashboardUrl },
    ],
  };

  return envelope(card);
}

// ---------------------------------------------------------------------------
// 2) Threshold breach
// ---------------------------------------------------------------------------

const THRESHOLD_LABEL: Record<BreachInput["threshold"], { pct: number; level: string; tone: "warning" | "attention" }> = {
  threshold_80: { pct: 80, level: "approaching", tone: "warning" },
  threshold_100: { pct: 100, level: "over budget", tone: "attention" },
  threshold_120: { pct: 120, level: "20% over budget", tone: "attention" },
};

export function renderBreachCard(input: BreachInput): CardEnvelope {
  const { workspace, threshold, forecast, workspaceUrl, raiseLimitUrl } = input;
  const meta = THRESHOLD_LABEL[threshold];

  const facts: Array<{ title: string; value: string }> = [
    { title: "Workspace", value: workspace.name },
    {
      title: "Monthly limit",
      value: workspace.limitCents !== null ? formatCurrency(workspace.limitCents) : "—",
    },
    {
      title: "Spend MTD",
      value: `${formatCurrency(workspace.currentMonthCents)} · ${fmtPct(workspace.utilizationPct)}`,
    },
  ];

  if (forecast) {
    facts.push({
      title: "7-day run rate",
      value: `${fmtMoney(forecast.runRate7dCents)}/day`,
    });
    facts.push({
      title: "Projected EOM",
      value: fmtMoney(forecast.projectedMonthEndCents),
    });
  }

  const card: AdaptiveCard = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "Container",
        style: meta.tone,
        bleed: true,
        items: [
          {
            type: "TextBlock",
            text: `Workspace ${meta.level} · ${workspace.name}`,
            weight: "Bolder",
            size: "Large",
            color: meta.tone === "attention" ? "Attention" : "Warning",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: `Crossed ${meta.pct}% of monthly limit this month`,
            isSubtle: true,
            spacing: "None",
            wrap: true,
          },
        ],
      },
      { type: "FactSet", facts },
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Open workspace", url: workspaceUrl },
      { type: "Action.OpenUrl", title: "Adjust limit", url: raiseLimitUrl },
    ],
  };

  return envelope(card);
}

// ---------------------------------------------------------------------------
// 3) Forecast at-risk
// ---------------------------------------------------------------------------

export function renderForecastCard(input: ForecastInput): CardEnvelope {
  const { workspace, forecast, workspaceUrl } = input;

  const facts: Array<{ title: string; value: string }> = [
    { title: "Workspace", value: workspace.name },
    {
      title: "Spend MTD",
      value: `${formatCurrency(workspace.currentMonthCents)} · ${fmtPct(workspace.utilizationPct)}`,
    },
    {
      title: "7-day run rate",
      value:
        forecast.runRateWoWPct !== null
          ? `${fmtMoney(forecast.runRate7dCents)}/day · ${fmtDeltaPct(forecast.runRateWoWPct)} WoW`
          : `${fmtMoney(forecast.runRate7dCents)}/day`,
    },
    { title: "Projected EOM", value: projectedEomLabel(forecast.projectedMonthEndCents, workspace.limitCents) },
  ];

  if (forecast.crossesCapOn) {
    facts.push({ title: "Crosses 100% on", value: forecast.crossesCapOn });
  }

  const card: AdaptiveCard = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "Container",
        style: "warning",
        bleed: true,
        items: [
          {
            type: "TextBlock",
            text: `Forecast: ${workspace.name} projected to overshoot`,
            weight: "Bolder",
            size: "Medium",
            color: "Warning",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: "Status flipped to at_risk on the latest sync",
            isSubtle: true,
            spacing: "None",
            wrap: true,
          },
        ],
      },
      { type: "FactSet", facts },
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Open workspace", url: workspaceUrl },
    ],
  };

  return envelope(card);
}

// ---------------------------------------------------------------------------
// 4) Stale-data warning
// ---------------------------------------------------------------------------

export function renderStaleCard(input: StaleInput): CardEnvelope {
  const { sync, month, dashboardUrl } = input;
  const card: AdaptiveCard = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "Container",
        style: "attention",
        bleed: true,
        items: [
          {
            type: "TextBlock",
            text: "Claude spend data is stale",
            weight: "Bolder",
            size: "Large",
            color: "Attention",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: `Last sync was ${fmtAgo(sync.ageMinutes)}. Digest and breach alerts are suppressed until the sync recovers.`,
            isSubtle: true,
            spacing: "None",
            wrap: true,
          },
        ],
      },
      {
        type: "FactSet",
        facts: [
          { title: "Billing month", value: month },
          {
            title: "Last sync",
            value: sync.lastSyncedAt ? sync.lastSyncedAt.toISOString() : "never",
          },
        ],
      },
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Open dashboard", url: dashboardUrl },
    ],
  };
  return envelope(card);
}
