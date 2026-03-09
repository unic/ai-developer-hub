const GITHUB_API_BASE = "https://api.github.com";

// ---------------------------------------------------------------------------
// Response wrapper
// ---------------------------------------------------------------------------

interface CopilotApiResponse<T> {
  data: T | null;
  error: string | null;
  rateLimitRemaining: number;
  rateLimitReset: number;
}

// ---------------------------------------------------------------------------
// Copilot Billing types
// ---------------------------------------------------------------------------

export interface CopilotSeatBreakdown {
  total: number;
  added_this_cycle: number;
  pending_cancellation: number;
  pending_invitation: number;
  active_this_cycle: number;
  inactive_this_cycle: number;
}

export interface CopilotBillingData {
  seat_breakdown: CopilotSeatBreakdown;
  seat_management_setting: string;
  public_code_suggestions: string;
  ide_chat: string;
  platform_chat: string;
  cli: string;
  plan_type: "business" | "enterprise";
}

// ---------------------------------------------------------------------------
// Copilot Seat types
// ---------------------------------------------------------------------------

export interface CopilotSeatAssignee {
  login: string;
  id: number;
  avatar_url: string;
}

export interface CopilotSeat {
  assignee: CopilotSeatAssignee;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  last_activity_editor: string | null;
  plan_type: "business" | "enterprise";
  pending_cancellation_date: string | null;
}

interface CopilotSeatsPage {
  total_seats: number;
  seats: CopilotSeat[];
}

// ---------------------------------------------------------------------------
// Copilot Metrics types
// ---------------------------------------------------------------------------

export interface CopilotMetricsLanguage {
  name: string;
  total_engaged_users: number;
  total_code_suggestions: number;
  total_code_acceptances: number;
  total_code_lines_suggested: number;
  total_code_lines_accepted: number;
}

export interface CopilotMetricsEditorModel {
  name: string;
  is_custom_model: boolean;
  total_engaged_users: number;
  total_code_suggestions: number;
  total_code_acceptances: number;
  total_code_lines_suggested: number;
  total_code_lines_accepted: number;
}

export interface CopilotMetricsEditor {
  name: string;
  total_engaged_users: number;
  models: CopilotMetricsEditorModel[];
}

export interface CopilotIdeCodeCompletions {
  total_engaged_users: number;
  languages: CopilotMetricsLanguage[];
  editors: CopilotMetricsEditor[];
}

export interface CopilotIdeChat {
  total_engaged_users: number;
  total_turns: number;
  total_acceptances: number;
}

export interface CopilotDotcomChat {
  total_engaged_users: number;
  total_turns: number;
}

export interface CopilotDotcomPullRequests {
  total_engaged_users: number;
  total_pr_summaries_created: number;
}

export interface CopilotDailyMetrics {
  date: string;
  total_active_users: number;
  total_engaged_users: number;
  copilot_ide_code_completions: CopilotIdeCodeCompletions | null;
  copilot_ide_chat?: CopilotIdeChat | null;
  copilot_dotcom_chat?: CopilotDotcomChat | null;
  copilot_dotcom_pull_requests?: CopilotDotcomPullRequests | null;
}

// ---------------------------------------------------------------------------
// Internal fetch helper (mirrors githubFetch in github.ts)
// ---------------------------------------------------------------------------

function parseHeaders(headers: Headers) {
  const rateLimitRemaining = parseInt(
    headers.get("x-ratelimit-remaining") || "0",
    10
  );
  const rateLimitReset = parseInt(
    headers.get("x-ratelimit-reset") || "0",
    10
  );
  const scopes = (headers.get("x-oauth-scopes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { rateLimitRemaining, rateLimitReset, scopes };
}

async function copilotFetch<T>(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<CopilotApiResponse<T> & { scopes: string[] }> {
  const url = new URL(`${GITHUB_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  const { rateLimitRemaining, rateLimitReset, scopes } = parseHeaders(
    response.headers
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { message?: string }).message ||
      `GitHub API error: ${response.status}`;
    return {
      data: null,
      error: message,
      scopes,
      rateLimitRemaining,
      rateLimitReset,
    };
  }

  const data = (await response.json()) as T;
  return { data, error: null, scopes, rateLimitRemaining, rateLimitReset };
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Fetch Copilot billing summary for an organization.
 * GET /orgs/{org}/copilot/billing
 */
export async function fetchCopilotBilling(
  token: string,
  org: string
): Promise<CopilotApiResponse<CopilotBillingData>> {
  const result = await copilotFetch<CopilotBillingData>(
    `/orgs/${encodeURIComponent(org)}/copilot/billing`,
    token
  );

  return {
    data: result.data,
    error: result.error,
    rateLimitRemaining: result.rateLimitRemaining,
    rateLimitReset: result.rateLimitReset,
  };
}

/**
 * Fetch all Copilot seat assignments for an organization (paginated).
 * GET /orgs/{org}/copilot/billing/seats
 */
export async function fetchCopilotSeats(
  token: string,
  org: string
): Promise<CopilotApiResponse<CopilotSeat[]>> {
  const allSeats: CopilotSeat[] = [];
  let page = 1;
  let rateLimitRemaining = 5000;
  let rateLimitReset = 0;

  while (true) {
    const result = await copilotFetch<CopilotSeatsPage>(
      `/orgs/${encodeURIComponent(org)}/copilot/billing/seats`,
      token,
      { per_page: "100", page: String(page) }
    );

    rateLimitRemaining = result.rateLimitRemaining;
    rateLimitReset = result.rateLimitReset;

    if (result.error) {
      return {
        data: null,
        error: result.error,
        rateLimitRemaining,
        rateLimitReset,
      };
    }

    const seats = result.data?.seats || [];
    allSeats.push(...seats);

    if (seats.length < 100) break;
    page++;

    if (rateLimitRemaining < 100) {
      return {
        data: null,
        error: `Rate limit approaching (${rateLimitRemaining} remaining). Reset at ${new Date(rateLimitReset * 1000).toISOString()}`,
        rateLimitRemaining,
        rateLimitReset,
      };
    }
  }

  return {
    data: allSeats,
    error: null,
    rateLimitRemaining,
    rateLimitReset,
  };
}

/**
 * Fetch Copilot usage metrics for an organization.
 * GET /orgs/{org}/copilot/metrics
 *
 * Optionally filter by date range using `since` and `until` (ISO date strings).
 */
export async function fetchCopilotMetrics(
  token: string,
  org: string,
  since?: string,
  until?: string
): Promise<CopilotApiResponse<CopilotDailyMetrics[]>> {
  const params: Record<string, string> = {};
  if (since) params.since = since;
  if (until) params.until = until;

  const result = await copilotFetch<CopilotDailyMetrics[]>(
    `/orgs/${encodeURIComponent(org)}/copilot/metrics`,
    token,
    Object.keys(params).length > 0 ? params : undefined
  );

  return {
    data: result.data,
    error: result.error,
    rateLimitRemaining: result.rateLimitRemaining,
    rateLimitReset: result.rateLimitReset,
  };
}

/**
 * Validate that the provided token has the `manage_billing:copilot` scope
 * by making a lightweight request and inspecting the `x-oauth-scopes` header.
 */
export async function validateCopilotScopes(
  token: string
): Promise<CopilotApiResponse<{ valid: boolean; scopes: string[] }>> {
  // Use /user as a lightweight endpoint to inspect scopes
  const result = await copilotFetch<unknown>("/user", token);

  const scopes = result.scopes;
  const hasScope = scopes.some(
    (s) =>
      s === "manage_billing:copilot" ||
      s === "admin:org" // admin:org implies billing access
  );

  if (result.error) {
    return {
      data: null,
      error: result.error,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitReset: result.rateLimitReset,
    };
  }

  if (!hasScope) {
    return {
      data: { valid: false, scopes },
      error: `Token missing required scope: manage_billing:copilot. Current scopes: ${scopes.join(", ")}`,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitReset: result.rateLimitReset,
    };
  }

  return {
    data: { valid: true, scopes },
    error: null,
    rateLimitRemaining: result.rateLimitRemaining,
    rateLimitReset: result.rateLimitReset,
  };
}
