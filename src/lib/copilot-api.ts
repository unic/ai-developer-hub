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
// Copilot Metrics types
// ---------------------------------------------------------------------------

// Top-level language summary (no suggestion/acceptance counts)
export interface CopilotMetricsLanguageSummary {
  name: string;
  total_engaged_users: number;
}

// Detailed language metrics (only at editors[].models[].languages[])
export interface CopilotMetricsModelLanguage {
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
  custom_model_training_date?: string | null;
  total_engaged_users: number;
  languages?: CopilotMetricsModelLanguage[];
}

export interface CopilotMetricsEditor {
  name: string;
  total_engaged_users: number;
  models?: CopilotMetricsEditorModel[];
}

export interface CopilotIdeCodeCompletions {
  total_engaged_users: number;
  languages?: CopilotMetricsLanguageSummary[];
  editors?: CopilotMetricsEditor[];
}

export interface CopilotIdeChatModel {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date?: string | null;
  total_engaged_users: number;
  total_chats: number;
  total_chat_insertion_events: number;
  total_chat_copy_events: number;
}

export interface CopilotIdeChatEditor {
  name: string;
  total_engaged_users: number;
  models?: CopilotIdeChatModel[];
}

export interface CopilotIdeChat {
  total_engaged_users: number;
  editors?: CopilotIdeChatEditor[];
}

export interface CopilotDotcomChatModel {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date?: string | null;
  total_engaged_users: number;
  total_chats: number;
}

export interface CopilotDotcomChat {
  total_engaged_users: number;
  models?: CopilotDotcomChatModel[];
}

export interface CopilotDotcomPrModel {
  name: string;
  is_custom_model: boolean;
  custom_model_training_date?: string | null;
  total_engaged_users: number;
  total_pr_summaries_created: number;
}

export interface CopilotDotcomPrRepository {
  name: string;
  total_engaged_users: number;
  models?: CopilotDotcomPrModel[];
}

export interface CopilotDotcomPullRequests {
  total_engaged_users: number;
  repositories?: CopilotDotcomPrRepository[];
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

  while (true) {
    const result = await githubFetch<CopilotSeatsPage>(
      `/orgs/${encodeURIComponent(org)}/copilot/billing/seats`,
      token,
      { per_page: "100", page: String(page) },
    );

    rateLimitRemaining = result.rateLimitRemaining;
    rateLimitReset = result.rateLimitReset;

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
    status: 200,
    rateLimitRemaining,
    rateLimitReset,
  };
}

/**
 * Fetch Copilot usage metrics for an organization.
 * GET /orgs/{org}/copilot/metrics
 */
export async function fetchCopilotMetrics(
  token: string,
  org: string,
  since?: string,
  until?: string,
): Promise<CopilotApiResponse<CopilotDailyMetrics[]>> {
  const params: Record<string, string> = {};
  if (since) params.since = since;
  if (until) params.until = until;

  return stripScopes(
    await githubFetch<CopilotDailyMetrics[]>(
      `/orgs/${encodeURIComponent(org)}/copilot/metrics`,
      token,
      Object.keys(params).length > 0 ? params : undefined,
    ),
  );
}

/**
 * Validate that the provided token has the `manage_billing:copilot` scope
 * by making a lightweight request and inspecting the `x-oauth-scopes` header.
 */
export async function validateCopilotScopes(
  token: string,
): Promise<CopilotApiResponse<{ valid: boolean; scopes: string[] }>> {
  const result = await githubFetch<unknown>("/user", token);

  const scopes = result.scopes;
  const hasScope = scopes.some(
    (s) => s === "manage_billing:copilot" || s === "admin:org",
  );

  if (result.error) {
    return {
      data: null,
      error: result.error,
      status: result.status,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitReset: result.rateLimitReset,
    };
  }

  if (!hasScope) {
    return {
      data: { valid: false, scopes },
      error: `Token missing required scope: manage_billing:copilot. Current scopes: ${scopes.join(", ")}`,
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
