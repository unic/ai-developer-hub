import { describe, expect, it } from "vitest";
import {
  isAnthropicReceiptText,
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

  it("recognises an Anthropic receipt from the PDF text", () => {
    expect(isAnthropicReceiptText("Anthropic Ireland, Limited $67.08")).toBe(
      true,
    );
    expect(isAnthropicReceiptText("Invoice from Example Supplier Ltd")).toBe(
      false,
    );
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
