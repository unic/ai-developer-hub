import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  type TemplateContext,
} from "@/lib/license-requests/render-template";

const ctx: TemplateContext = {
  requester: {
    name: "Anna Schmid",
    firstName: "Anna",
    email: "anna.schmid@unic.com",
  },
  tool: { name: "GitHub Copilot" },
  tier: { name: "Business" },
  licenseCode: "sk-test-1234",
  approver: { name: "Tobias Studer", firstName: "Tobias" },
  requestUrl: "https://aihub.example.com/requests/42",
  form: {
    github_username: "annaschmid",
    justification: "Need it for daily work",
  },
};

describe("renderTemplate", () => {
  it("substitutes top-level variables", () => {
    const out = renderTemplate("Hi {{requester.firstName}}", ctx);
    expect(out.rendered).toBe("Hi Anna");
    expect(out.missingVariables).toEqual([]);
  });

  it("substitutes nested dotted paths", () => {
    const out = renderTemplate("{{tool.name}} / {{tier.name}}", ctx);
    expect(out.rendered).toBe("GitHub Copilot / Business");
  });

  it("resolves form.* values from the JSONB payload", () => {
    const out = renderTemplate("GH user: {{form.github_username}}", ctx);
    expect(out.rendered).toBe("GH user: annaschmid");
  });

  it("leaves unknown variables in place and lists them", () => {
    const out = renderTemplate("Hello {{form.manager_email}}", ctx);
    expect(out.rendered).toBe("Hello {{form.manager_email}}");
    expect(out.missingVariables).toEqual(["form.manager_email"]);
  });

  it("deduplicates missing variables", () => {
    const out = renderTemplate("{{x}} {{x}} {{x}}", ctx);
    expect(out.missingVariables).toEqual(["x"]);
  });

  it("returns null tier as missing when referenced", () => {
    const localCtx: TemplateContext = { ...ctx, tier: null };
    const out = renderTemplate("Tier: {{tier.name}}", localCtx);
    expect(out.rendered).toContain("{{tier.name}}");
    expect(out.missingVariables).toContain("tier.name");
  });

  it("renders numbers and booleans as strings", () => {
    const localCtx: TemplateContext = {
      ...ctx,
      form: { count: 5, active: true },
    };
    const out = renderTemplate("count={{form.count}} active={{form.active}}", localCtx);
    expect(out.rendered).toBe("count=5 active=true");
  });

  it("ignores variables that don't match the pattern", () => {
    const out = renderTemplate("not a var: {single} or {{ bad path }}", ctx);
    expect(out.rendered).toBe("not a var: {single} or {{ bad path }}");
  });

  it("tolerates whitespace inside the braces", () => {
    const out = renderTemplate("Hi {{ requester.firstName }}", ctx);
    expect(out.rendered).toBe("Hi Anna");
  });

  // 032-v2 masking contract: the approve dialog renders the template WITHOUT
  // binding licenseCode, so the token must survive rendering literally — the
  // stored message never contains the key (resolved on demand from the
  // encrypted assignment by getRequestMessage).
  it("leaves {{licenseCode}} literal when licenseCode is not bound", () => {
    const localCtx: TemplateContext = { ...ctx, licenseCode: undefined };
    const out = renderTemplate("Key: `{{licenseCode}}`", localCtx);
    expect(out.rendered).toBe("Key: `{{licenseCode}}`");
    expect(out.missingVariables).toContain("licenseCode");
  });
});
