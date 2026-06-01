import { describe, expect, it } from "vitest";
import {
  renderBreachCard,
  renderDigestCard,
  renderForecastCard,
  renderStaleCard,
} from "@/lib/teams/cards";
import type { WorkspaceForecast } from "@/lib/anthropic/forecast-workspace";
import type { WorkspaceListItem, DashboardKpis, SyncStatus } from "@/types";

const baseWorkspace: WorkspaceListItem = {
  workspaceId: "ws-research",
  name: "research-claude",
  isDefault: false,
  isArchived: false,
  currentMonthCents: 5_120_40,
  limitCents: 5_000_00,
  utilizationPct: 102,
  displayColor: null,
  todayEstimate: null,
};

const baseForecast: WorkspaceForecast = {
  runRate7dCents: 612_00,
  runRate30dCents: 180_00,
  runRateWoWPct: 240,
  projectedMonthEndCents: 8_940_00,
  crossesCapOn: "2026-05-28",
  status: "at_risk",
};

const baseKpis: DashboardKpis = {
  totalCents: 18_420_00,
  momDeltaCents: 1_500_00,
  momDeltaPct: 12,
  projectedMonthEndCents: 25_000_00,
  workspacesOverEightyCount: 3,
  workspacesWithLimitCount: 11,
  topOverWorkspaceName: "research-claude",
  topOverWorkspaceUtilizationPct: 102,
  priorMonthCents: 16_920_00,
  todayEstimate: null,
};

const baseSync: SyncStatus = {
  lastSyncedAt: new Date("2026-05-21T13:01:00Z"),
  ageMinutes: 1,
  isStale: false,
};

describe("renderDigestCard", () => {
  it("produces a valid Workflows envelope with one Adaptive Card", () => {
    const envelope = renderDigestCard({
      kpis: baseKpis,
      topWorkspaces: [baseWorkspace],
      sync: baseSync,
      month: "2026-05",
      dashboardUrl: "https://hub.example.com/claude",
    });
    expect(envelope.type).toBe("message");
    expect(envelope.attachments).toHaveLength(1);
    expect(envelope.attachments[0].contentType).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
    expect(envelope.attachments[0].content.version).toBe("1.4");
    expect(envelope.attachments[0].content.type).toBe("AdaptiveCard");
  });

  it("includes month, KPI text, and dashboard link", () => {
    const envelope = renderDigestCard({
      kpis: baseKpis,
      topWorkspaces: [baseWorkspace],
      sync: baseSync,
      month: "2026-05",
      dashboardUrl: "https://hub.example.com/claude",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain("2026-05");
    expect(json).toContain("$18,420");
    expect(json).toContain("3 of 11");
    expect(json).toContain("https://hub.example.com/claude");
  });

  it("only uses Action.OpenUrl (Workflows webhook constraint)", () => {
    const envelope = renderDigestCard({
      kpis: baseKpis,
      topWorkspaces: [],
      sync: baseSync,
      month: "2026-05",
      dashboardUrl: "https://hub.example.com/claude",
    });
    const actions = envelope.attachments[0].content.actions ?? [];
    for (const a of actions) {
      expect((a as { type: string }).type).toBe("Action.OpenUrl");
    }
  });
});

describe("renderBreachCard", () => {
  it("includes workspace name, threshold label, and adjust-limit link", () => {
    const envelope = renderBreachCard({
      workspace: baseWorkspace,
      threshold: "threshold_100",
      forecast: baseForecast,
      workspaceUrl: "https://hub.example.com/claude/workspaces/ws-research",
      raiseLimitUrl: "https://hub.example.com/claude/workspaces/ws-research#limit",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain("research-claude");
    expect(json).toContain("100%");
    expect(json).toContain("$5,120.40");
    expect(json).toContain("over budget");
    expect(json).toContain("ws-research");
  });

  it("uses attention tone for over-budget thresholds", () => {
    const envelope = renderBreachCard({
      workspace: baseWorkspace,
      threshold: "threshold_120",
      forecast: null,
      workspaceUrl: "x",
      raiseLimitUrl: "y",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain('"style":"attention"');
  });

  it("uses warning tone for 80% threshold", () => {
    const envelope = renderBreachCard({
      workspace: { ...baseWorkspace, utilizationPct: 85, currentMonthCents: 4_250_00 },
      threshold: "threshold_80",
      forecast: null,
      workspaceUrl: "x",
      raiseLimitUrl: "y",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain('"style":"warning"');
  });
});

describe("renderForecastCard", () => {
  it("includes WoW delta and crosses-cap date when present", () => {
    const envelope = renderForecastCard({
      workspace: { ...baseWorkspace, currentMonthCents: 4_200_00, utilizationPct: 84 },
      forecast: baseForecast,
      workspaceUrl: "https://hub.example.com/claude/workspaces/ws-research",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain("▲ 240% WoW");
    expect(json).toContain("2026-05-28");
  });

  it("omits crosses-cap when forecast has no date", () => {
    const envelope = renderForecastCard({
      workspace: baseWorkspace,
      forecast: { ...baseForecast, crossesCapOn: null },
      workspaceUrl: "x",
    });
    const json = JSON.stringify(envelope);
    expect(json).not.toContain("Crosses 100% on");
  });
});

describe("renderStaleCard", () => {
  it("is rendered in attention style with sync age", () => {
    const staleSync: SyncStatus = {
      lastSyncedAt: new Date("2026-05-21T10:00:00Z"),
      ageMinutes: 180,
      isStale: true,
    };
    const envelope = renderStaleCard({
      sync: staleSync,
      month: "2026-05",
      dashboardUrl: "https://hub.example.com/claude",
    });
    const json = JSON.stringify(envelope);
    expect(json).toContain('"style":"attention"');
    expect(json).toContain("stale");
    // fmtAgo delegates to date-fns; assert any relative phrase landed.
    expect(json).toMatch(/ago/);
  });
});
