// Tiny mustache-style template renderer for license-request messages.
// Spec 032-automation-workflow Phase 4.
//
// Why roll our own instead of pulling in `mustache`: we need exactly one
// feature — dotted-path variable substitution — plus a list of unknown
// variables surfaced back to the template editor as warnings (the
// silent-break safety net for MS Forms key renames). The whole thing is
// ~30 lines and trivially testable.

export interface TemplateContext {
  requester: { name: string; firstName: string; email: string };
  tool: { name: string };
  tier: { name: string } | null;
  /** Completion-only — undefined at approve time. */
  licenseCode?: string;
  /** Approver / completer's identity, for `{{approver.firstName}}` etc. */
  approver?: { name: string; firstName: string };
  /** Deep link to the Hub request detail page. */
  requestUrl: string;
  /** Raw form_payload — referenced via `{{form.<key>}}`. */
  form: Record<string, unknown>;
}

export interface RenderResult {
  rendered: string;
  /** Variable paths that were referenced but not resolvable. Templates that
   * reference these still render — the literal `{{path}}` is left in place
   * so the issue is visible — but the editor surfaces them as warnings. */
  missingVariables: string[];
}

const VAR_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

function resolvePath(ctx: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Objects / arrays — render as compact JSON so the user sees something
  // intelligible (matters for `{{form.someStruct}}`).
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function renderTemplate(bodyMd: string, ctx: TemplateContext): RenderResult {
  const missing: string[] = [];
  const rendered = bodyMd.replace(VAR_PATTERN, (_, path: string) => {
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) {
      if (!missing.includes(path)) missing.push(path);
      return `{{${path}}}`;
    }
    return stringify(value);
  });
  return { rendered, missingVariables: missing };
}

/** List of all top-level dotted variables that template authors can reference.
 * The sidebar in the template editor uses this list. */
export const KNOWN_VARIABLE_PATHS: readonly string[] = [
  "requester.name",
  "requester.firstName",
  "requester.email",
  "tool.name",
  "tier.name",
  "licenseCode",
  "approver.name",
  "approver.firstName",
  "requestUrl",
  // form.* is dynamic; the editor extracts available keys from recent
  // form_payload samples per tool.
] as const;
