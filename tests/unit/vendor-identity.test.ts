import { describe, expect, it } from "vitest";
import {
  isAnthropicVendor,
  vendorFilterMatches,
  vendorsEquivalent,
} from "@/lib/vendor-identity";

describe("Anthropic vendor identity", () => {
  it("treats PBC, Ireland, and the short tool vendor as one supplier", () => {
    expect(
      vendorsEquivalent("Anthropic, PBC", "Anthropic Ireland, Limited"),
    ).toBe(true);
    expect(vendorsEquivalent("Anthropic", "Anthropic Ireland, Limited")).toBe(
      true,
    );
    expect(isAnthropicVendor("Anthropic Ireland, Limited")).toBe(true);
    expect(isAnthropicVendor("Anthropic, PBC")).toBe(true);
  });

  it("does not fold an unrelated vendor into Anthropic", () => {
    expect(vendorsEquivalent("Anthropic, PBC", "GitHub")).toBe(false);
    expect(isAnthropicVendor("OpenAI")).toBe(false);
  });

  it("lets a PBC allow-list value match an Ireland receipt", () => {
    expect(
      vendorFilterMatches("Anthropic Ireland, Limited", ["Anthropic, PBC"]),
    ).toBe(true);
    expect(vendorFilterMatches("Anthropic, PBC", ["anthropic"])).toBe(true);
    expect(vendorFilterMatches("GitHub", ["Anthropic, PBC"])).toBe(false);
  });
});
