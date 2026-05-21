import { describe, it, expect } from "vitest";
import { mapNdjsonRowToDbRow } from "@/lib/copilot-sync";
import type { CopilotMetricsRow } from "@/lib/copilot-api";

describe("mapNdjsonRowToDbRow", () => {
  const fullRow: CopilotMetricsRow = {
    day: "2026-05-18",
    organization_id: 12345,
    code_generation_activity_count: 4200,
    code_acceptance_activity_count: 1800,
    loc_suggested_to_add_sum: 32000,
    loc_added_sum: 14500,
    chat_panel_ask_mode: 320,
    chat_panel_agent_mode: 95,
    chat_panel_edit_mode: 40,
    chat_panel_plan_mode: 12,
    chat_panel_custom_mode: 3,
    chat_panel_unknown_mode: 0,
    agent_edit: 18,
    totals_by_ide: { vscode: { completions: 3000 } },
    totals_by_language_feature: {
      "TypeScript|code_completion": { suggestions: 1200, acceptances: 480 },
    },
    totals_by_cli: {
      session_count: 12,
      request_count: 84,
      prompt_count: 84,
    },
  };

  it("maps activity counters straight across", () => {
    const out = mapNdjsonRowToDbRow(1, "2026-05-18", fullRow, {
      active: 32,
      engaged: 24,
    });
    expect(out.connectionId).toBe(1);
    expect(out.date).toBe("2026-05-18");
    expect(out.totalSuggestions).toBe(4200);
    expect(out.totalAcceptances).toBe(1800);
    expect(out.totalLinesSuggested).toBe(32000);
    expect(out.totalLinesAccepted).toBe(14500);
    expect(out.totalActiveUsers).toBe(32);
    expect(out.totalEngagedUsers).toBe(24);
  });

  it("sums chat-panel mode counters into totalChatTurns", () => {
    const out = mapNdjsonRowToDbRow(1, "2026-05-18", fullRow, {
      active: 0,
      engaged: 0,
    });
    // 320 + 95 + 40 + 12 + 3 + 0 = 470
    expect(out.totalChatTurns).toBe(470);
  });

  it("derives usedCli + usedAgent + agentEditCount from new fields", () => {
    const out = mapNdjsonRowToDbRow(1, "2026-05-18", fullRow, {
      active: 0,
      engaged: 0,
    });
    expect(out.usedCli).toBe(true);
    expect(out.usedAgent).toBe(true);
    expect(out.agentEditCount).toBe(18);
    expect(out.cliBreakdown).toEqual(fullRow.totals_by_cli);
  });

  it("writes null for deprecated dotcom-chat and PR-summary columns", () => {
    const out = mapNdjsonRowToDbRow(1, "2026-05-18", fullRow, {
      active: 0,
      engaged: 0,
    });
    expect(out.totalDotcomChatTurns).toBeNull();
    expect(out.totalPrSummaries).toBeNull();
  });

  it("forwards JSONB breakdown shapes verbatim", () => {
    const out = mapNdjsonRowToDbRow(1, "2026-05-18", fullRow, {
      active: 0,
      engaged: 0,
    });
    expect(out.editorBreakdown).toEqual(fullRow.totals_by_ide);
    expect(out.languageBreakdown).toEqual(fullRow.totals_by_language_feature);
  });

  it("returns 0 for missing activity fields and null chat when no mode keys present", () => {
    const sparse: CopilotMetricsRow = { day: "2026-05-18" };
    const out = mapNdjsonRowToDbRow(7, "2026-05-18", sparse, {
      active: 0,
      engaged: 0,
    });
    expect(out.totalSuggestions).toBe(0);
    expect(out.totalAcceptances).toBe(0);
    expect(out.totalLinesSuggested).toBe(0);
    expect(out.totalLinesAccepted).toBe(0);
    expect(out.totalChatTurns).toBeNull();
    expect(out.usedCli).toBe(false);
    expect(out.usedAgent).toBe(false);
    expect(out.agentEditCount).toBeNull();
    expect(out.cliBreakdown).toBeNull();
    expect(out.editorBreakdown).toBeNull();
    expect(out.languageBreakdown).toBeNull();
  });
});
