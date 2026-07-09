import { describe, it, expect } from "vitest";
import { licenseRequestIngestSchema } from "@/lib/validators";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    formResponseId: "1",
    requesterEmail: "a@unic.com",
    requesterName: "A",
    formPayload: {},
    teamsTeamId: "t",
    teamsChannelId: "c",
    teamsParentMessageId: "m",
    teamsChatId: "ch",
    ...overrides,
  };
}

describe("licenseRequestIngestSchema — case-insensitive role/profile", () => {
  it("accepts Title Case and UPPER case values, normalized to lowercase", () => {
    const parsed = licenseRequestIngestSchema.parse(
      payload({ role: "Development", profile: "MAXED", justification: "x" }),
    );
    expect(parsed.role).toBe("development");
    expect(parsed.profile).toBe("maxed");
  });

  it("trims surrounding whitespace", () => {
    const parsed = licenseRequestIngestSchema.parse(
      payload({ role: " Business ", profile: " Indie ", justification: "x" }),
    );
    expect(parsed.role).toBe("business");
    expect(parsed.profile).toBe("indie");
  });

  it("still rejects unknown values", () => {
    expect(
      licenseRequestIngestSchema.safeParse(payload({ role: "Wizard" })).success,
    ).toBe(false);
  });

  it("empty profile passes (baseline) and requires no justification", () => {
    const parsed = licenseRequestIngestSchema.parse(
      payload({ role: "development", profile: "" }),
    );
    expect(parsed.profile).toBe("");
  });

  it("requires justification for maxed/indie regardless of input case", () => {
    const result = licenseRequestIngestSchema.safeParse(
      payload({ role: "development", profile: "Indie" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("justification");
    }
  });

  it("does not require justification on the legacy branch (profile without role)", () => {
    // A partially updated caller may send a stray profile alongside the v1
    // tool fields — the v2 justification rule must not apply.
    const result = licenseRequestIngestSchema.safeParse(
      payload({ toolName: "GitHub Copilot", profile: "maxed" }),
    );
    expect(result.success).toBe(true);
  });
});
