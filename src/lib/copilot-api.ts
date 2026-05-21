import { githubFetch, type GitHubApiResponse } from "@/lib/github";

type CopilotApiResponse<T> = Omit<GitHubApiResponse<T>, "scopes">;

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
// Copilot Usage Metrics types (new reports API, replaces sunset 2026-04-02 endpoint)
// ---------------------------------------------------------------------------

/**
 * Wrapper response from /orgs/{org}/copilot/metrics/reports/organization-1-day.
 * The actual data lives behind one or more signed URLs in `download_links`.
 */
export interface CopilotReportLinks {
  download_links: string[];
  report_day?: string;
  report_start_day?: string;
  report_end_day?: string;
}

/**
 * One row in an NDJSON Copilot usage metrics report. The docs cover "only some"
 * fields (community discussion #186189), so this type is intentionally loose:
 * known fields are typed, unknown keys are preserved via the index signature.
 */
export interface CopilotMetricsRow {
  day?: string;
  organization_id?: number;
  enterprise_id?: number | null;
  user_id?: number;
  user_login?: string;

  user_initiated_interaction_count?: number;
  code_generation_activity_count?: number;
  code_acceptance_activity_count?: number;

  loc_suggested_to_add_sum?: number;
  loc_added_sum?: number;
  loc_suggested_to_delete_sum?: number;
  loc_deleted_sum?: number;
  agent_edit?: number;

  chat_panel_agent_mode?: number;
  chat_panel_ask_mode?: number;
  chat_panel_edit_mode?: number;
  chat_panel_plan_mode?: number;
  chat_panel_custom_mode?: number;
  chat_panel_unknown_mode?: number;

  used_cli?: boolean;
  used_agent?: boolean;
  used_chat?: boolean;

  totals_by_ide?: Record<string, Record<string, unknown>>;
  totals_by_feature?: Record<string, Record<string, unknown>>;
  totals_by_language_feature?: Record<string, Record<string, unknown>>;
  totals_by_language_model?: Record<string, Record<string, unknown>>;
  totals_by_model_feature?: Record<string, Record<string, unknown>>;
  totals_by_cli?: {
    session_count?: number;
    request_count?: number;
    prompt_count?: number;
    last_known_cli_version?: string;
    token_usage?: {
      output_tokens_sum?: number;
      prompt_tokens_sum?: number;
      avg_tokens_per_request?: number;
    };
  };

  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripScopes<T>(result: GitHubApiResponse<T>): CopilotApiResponse<T> {
  return {
    data: result.data,
    error: result.error,
    status: result.status,
    rateLimitRemaining: result.rateLimitRemaining,
    rateLimitReset: result.rateLimitReset,
  };
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
  org: string,
): Promise<CopilotApiResponse<CopilotBillingData>> {
  return stripScopes(
    await githubFetch<CopilotBillingData>(
      `/orgs/${encodeURIComponent(org)}/copilot/billing`,
      token,
    ),
  );
}

/**
 * Fetch all Copilot seat assignments for an organization (paginated).
 * GET /orgs/{org}/copilot/billing/seats
 */
export async function fetchCopilotSeats(
  token: string,
  org: string,
): Promise<CopilotApiResponse<CopilotSeat[]>> {
  const allSeats: CopilotSeat[] = [];
  let page = 1;
  let rateLimitRemaining = 5000;
  let rateLimitReset = 0;
  let lastStatus = 200;

  while (true) {
    const result = await githubFetch<CopilotSeatsPage>(
      `/orgs/${encodeURIComponent(org)}/copilot/billing/seats`,
      token,
      { per_page: "100", page: String(page) },
    );

    rateLimitRemaining = result.rateLimitRemaining;
    rateLimitReset = result.rateLimitReset;
    lastStatus = result.status;

    if (result.error) {
      return {
        data: null,
        error: result.error,
        status: result.status,
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
        status: result.status,
        rateLimitRemaining,
        rateLimitReset,
      };
    }
  }

  return {
    data: allSeats,
    error: null,
    status: lastStatus,
    rateLimitRemaining,
    rateLimitReset,
  };
}

/**
 * Fetch the wrapper response for a single-day org Copilot usage metrics report.
 * GET /orgs/{org}/copilot/metrics/reports/organization-1-day?day=YYYY-MM-DD
 *
 * Replaces the sunset (2026-04-02) endpoint /orgs/{org}/copilot/metrics. The
 * actual metric rows live behind signed URLs in the returned `download_links`;
 * call `downloadReportNdjson` on each link to fetch the NDJSON data.
 */
export async function fetchCopilotOrgDayReport(
  token: string,
  org: string,
  day: string,
): Promise<CopilotApiResponse<CopilotReportLinks>> {
  return stripScopes(
    await githubFetch<CopilotReportLinks>(
      `/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/organization-1-day`,
      token,
      { day },
    ),
  );
}

/**
 * Fetch the wrapper response for a single-day per-user Copilot usage metrics
 * report. GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD
 *
 * Each row in the downloaded NDJSON represents one (user, day) tuple. Used to
 * derive `total_active_users` and `total_engaged_users` counters that the
 * org-level report does not expose directly.
 */
export async function fetchCopilotUsersDayReport(
  token: string,
  org: string,
  day: string,
): Promise<CopilotApiResponse<CopilotReportLinks>> {
  return stripScopes(
    await githubFetch<CopilotReportLinks>(
      `/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/users-1-day`,
      token,
      { day },
    ),
  );
}

/**
 * Download and parse the NDJSON body behind a signed Copilot report URL.
 *
 * Signed URLs authenticate via the signature itself — do NOT add an
 * Authorization header (doing so triggers 403). TTL is undocumented; fetch
 * immediately and never cache the URL.
 */
export async function downloadReportNdjson(
  url: string,
): Promise<CopilotMetricsRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Copilot report download ${res.status} from ${new URL(url).host}`,
    );
  }
  const body = await res.text();
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CopilotMetricsRow);
}

/**
 * Validate that the provided token has the scopes needed to call both the
 * Copilot billing endpoints (`manage_billing:copilot` or `admin:org`) and the
 * new Copilot usage metrics reports endpoints (`read:org`).
 */
export async function validateCopilotScopes(
  token: string,
): Promise<CopilotApiResponse<{ valid: boolean; scopes: string[] }>> {
  const result = await githubFetch<unknown>("/user", token);

  const scopes = result.scopes;

  if (result.error) {
    return {
      data: null,
      error: result.error,
      status: result.status,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitReset: result.rateLimitReset,
    };
  }

  const hasBillingScope = scopes.some(
    (s) => s === "manage_billing:copilot" || s === "admin:org",
  );
  const hasOrgReadScope = scopes.some(
    (s) => s === "read:org" || s === "admin:org",
  );

  const missing: string[] = [];
  if (!hasBillingScope) missing.push("manage_billing:copilot");
  if (!hasOrgReadScope) missing.push("read:org");

  if (missing.length > 0) {
    return {
      data: { valid: false, scopes },
      error: `Token missing required scope(s): ${missing.join(", ")}. The new Copilot usage metrics API requires read:org in addition to manage_billing:copilot. Current scopes: ${scopes.join(", ") || "(none)"}`,
      status: result.status,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitReset: result.rateLimitReset,
    };
  }

  return {
    data: { valid: true, scopes },
    error: null,
    status: result.status,
    rateLimitRemaining: result.rateLimitRemaining,
    rateLimitReset: result.rateLimitReset,
  };
}
