import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  users,
  aiTools,
  accessTiers,
  licenseAssignments,
  annualBudgets,
  budgetPeriods,
  changeHistory,
  assignmentComments,
  billedCosts,
  invoices,
  githubConnections,
  githubProfiles,
  copilotUsageMetrics,
  copilotBillingSnapshots,
  anthropicWorkspaces,
  anthropicWorkspaceCosts,
  anthropicWorkspaceLimits,
  anthropicOrgConfig,
} from "@/lib/db/schema";

// Action result type
export type ActionResult<T = void> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// User appearance preferences (stored as JSONB on users table)
export type UserPreferences = {
  theme: "light" | "dark" | "system";
};

// Role and status types
export type UserRole = "admin" | "viewer";
export type UserStatus = "active" | "inactive";
export type ToolStatus = "active" | "archived";
export type AssignmentStatus = "active" | "inactive";
export type BudgetStatus = "active" | "archived";
export type PeriodType = "monthly" | "quarterly";
export type ChangeType = "created" | "updated" | "deleted" | "status_change";
export type UserProfile = "boost" | "maxed" | "indie";
export type UserDiscipline = "developer" | "conception" | "business";

// Select types (for reading from DB)
export type User = InferSelectModel<typeof users>;
export type AiTool = InferSelectModel<typeof aiTools>;
export type AccessTier = InferSelectModel<typeof accessTiers>;
export type LicenseAssignment = InferSelectModel<typeof licenseAssignments>;
export type AnnualBudget = InferSelectModel<typeof annualBudgets>;
export type BudgetPeriod = InferSelectModel<typeof budgetPeriods>;
export type ChangeHistoryRecord = InferSelectModel<typeof changeHistory>;
export type AssignmentComment = InferSelectModel<typeof assignmentComments>;
export type BilledCost = InferSelectModel<typeof billedCosts>;

// Insert types (for writing to DB)
export type NewUser = InferInsertModel<typeof users>;
export type NewAiTool = InferInsertModel<typeof aiTools>;
export type NewAccessTier = InferInsertModel<typeof accessTiers>;
export type NewLicenseAssignment = InferInsertModel<typeof licenseAssignments>;
export type NewAnnualBudget = InferInsertModel<typeof annualBudgets>;
export type NewBudgetPeriod = InferInsertModel<typeof budgetPeriods>;
export type NewChangeHistory = InferInsertModel<typeof changeHistory>;
export type NewAssignmentComment = InferInsertModel<typeof assignmentComments>;
export type NewBilledCost = InferInsertModel<typeof billedCosts>;
export type Invoice = InferSelectModel<typeof invoices>;
export type NewInvoice = InferInsertModel<typeof invoices>;

// Computed types for budget views
export type PeriodWithCosts = BudgetPeriod & {
  expectedSpendCents: number;
  billedTotalCents: number;
  billedEntries?: BilledCost[];
};

export type BudgetWithCosts = AnnualBudget & {
  periods: PeriodWithCosts[];
};

// Report data types for 005-rich-reports

export interface PeriodSpendPoint {
  month: string;
  billedCents: number;
  expectedCents: number;
  plannedCents: number;
  periodIndex: number;
}

export interface MonthlySpend {
  month: string;
  amountCents: number;
}

export interface ForecastPoint {
  month: string;
  projectedAmountCents: number;
}

export interface BudgetForecast {
  slopeCents: number;
  interceptCents: number;
  projections: ForecastPoint[];
  projectedRemainingCents: number;
  actualSpendToDateCents: number;
  projectedAnnualTotalCents: number;
  budgetCeilingCents: number;
  status: "on_track" | "at_risk";
  insufficientData?: string;
}

export interface ReportOverviewData {
  totalActiveUsers: number;
  totalActiveTools: number;
  totalActiveLicenses: number;
  expectedMonthlyCents: number;
  billedYtdCents: number;
  budgetCeilingCents: number;
  budgetRemainingCents: number;
  utilizationPct: number;
  spendTrend: "up" | "down" | "flat";
  spendTrendPct: number;
  /**
   * Snapshot of license activity as of the last calendar month-end.
   * Absent when no comparable prior data exists (e.g. fresh org).
   */
  previousMonth?: {
    activeLicenses: number;
    expectedMonthlyCents: number;
    assignmentsByTool: Record<number, number>;
    spendByTool: Record<number, number>;
  };
  /** Forecast status surfaced on the budget-health hero. Null when no active budget. */
  budgetForecast: {
    status: "on_track" | "at_risk";
    projectedAnnualTotalCents: number;
    projectedOverageCents: number;
  } | null;
  /** Most recent past period label (e.g. "Apr 2026") that had any actual spend. Null otherwise. */
  lastCompletedMonthLabel: string | null;
  lastCompletedMonthVariancePct: number | null;
}

export interface SparklinePoint {
  label: string;
  value: number;
}

export interface ToolSummaryItem {
  id: number;
  name: string;
  vendor: string;
  activeUsers: number;
  totalMonthlyCost: number;
}

export interface CircleReportItem {
  circle: string | null;
  userCount: number;
  licenseCount: number;
  totalMonthlyCost: number;
}

// Spec 028 — Reports v2 (Budget tab)

/** A budget period augmented with the running-API contribution and the resulting Actual. */
export type PeriodWithActual = PeriodWithCosts & {
  runningCostCents: number;
  actualCents: number;
};

/** YTD per-tool spend point used by the per-tool breakdown table. */
export interface BudgetPerToolRow {
  toolId: number | null;
  toolName: string;
  isAnthropicApi: boolean;
  ytdSpentCents: number;
  currentMonthlyCents: number;
  projectedEoyCents: number;
  /** Workspace-level rows shown when the tool is "Anthropic API" and there is more than one workspace. */
  workspaceBreakdown?: Array<{
    workspaceId: string | null;
    name: string;
    costCents: number;
  }>;
}

export interface BudgetReportPastMonth {
  periodId: number;
  periodLabel: string;
  /** The completed period immediately before {@link periodLabel}, if any. */
  priorPeriodLabel: string | null;
  plannedCents: number;
  billedCents: number;
  runningCents: number;
  actualCents: number;
  varianceCents: number;
  variancePct: number | null;
  /** Top variance drivers (per-tool MoM license-derived diffs). Up to 5. */
  drivers: Array<{
    toolId: number | null;
    toolName: string;
    /** License-derived spend in the prior period. */
    priorCents: number;
    /** License-derived spend in the past (spotlighted) period. */
    pastCents: number;
    /** pastCents − priorCents. */
    deltaCents: number;
    /** Percent change vs prior; null when prior was zero. */
    deltaPct: number | null;
  }>;
}

export type BudgetReportData =
  | { kind: "empty"; reason: "no_active_budget" }
  | {
      kind: "ready";
      budget: BudgetWithCosts;
      periodsWithActual: PeriodWithActual[];
      forecast: BudgetForecast;
      pastMonth: BudgetReportPastMonth | null;
      perTool: BudgetPerToolRow[];
    };

// Bulk import upsert result types
export interface BulkImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; email: string; error: string }>;
  inviteLinks?: Array<{ name: string; email: string; inviteUrl: string }>;
}

export interface ExistingUserFields {
  name: string;
  circle: string | null;
  role: string;
  githubUsername: string | null;
  profile: string | null;
  discipline: UserDiscipline;
}

// Invoice sync types
export type SyncOutcome =
  | "verified"
  | "newly_linked"
  | "corrected"
  | "unresolvable"
  | "error";

export interface SyncInvoiceOutcome {
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  vendor: string | null;
  outcome: SyncOutcome;
  previousPeriodLabel: string | null;
  newPeriodLabel: string | null;
  reason: string | null;
}

export interface SyncResult {
  totalProcessed: number;
  verified: number;
  newlyLinked: number;
  corrected: number;
  unresolvable: number;
  errors: number;
  items: SyncInvoiceOutcome[];
}

// GitHub integration types
export type GitHubConnectionStatus = "active" | "disconnected";

export type GitHubConnection = InferSelectModel<typeof githubConnections>;
export type NewGitHubConnection = InferInsertModel<typeof githubConnections>;
export type GitHubProfile = InferSelectModel<typeof githubProfiles>;
export type NewGitHubProfile = InferInsertModel<typeof githubProfiles>;

export interface GitHubMemberData {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  publicRepos: number | null;
  profileUrl: string;
}

export interface GitHubOrgData {
  login: string;
  id: number;
  avatarUrl: string | null;
  description: string | null;
}

export type MatchType = "username" | "email";

export interface SyncMatchedMember {
  githubLogin: string;
  githubId: number;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubBio: string | null;
  githubPublicRepos: number | null;
  githubProfileUrl: string;
  githubEmail: string | null;
  matchedUserId: number;
  matchedUserName: string;
  matchedUserEmail: string;
  matchType: MatchType;
  hasConflict: boolean;
  conflictDetail: string | null;
}

export interface SyncUnmatchedMember {
  githubLogin: string;
  githubId: number;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubBio: string | null;
  githubPublicRepos: number | null;
  githubProfileUrl: string;
  githubEmail: string | null;
}

export interface SyncUnmatchedSystemUser {
  userId: number;
  userName: string;
  userEmail: string;
  githubUsername: string | null;
  userStatus: "active" | "inactive";
}

export interface SyncConflict {
  githubLogin: string;
  usernameMatchUserId: number;
  emailMatchUserId: number;
  detail: string;
}

export interface SyncPreview {
  totalMembers: number;
  matched: SyncMatchedMember[];
  unmatched: SyncUnmatchedMember[];
  unmatchedSystemUsers: SyncUnmatchedSystemUser[];
  conflicts: SyncConflict[];
  rateLimitRemaining: number;
}


// GitHub member sync — manual matching types
export type PendingResolution =
  | { type: "import"; githubLogin: string }
  | { type: "match"; githubLogin: string; userId: number; userName: string }
  | {
      type: "create";
      githubLogin: string;
      name: string;
      email: string;
      discipline: UserDiscipline;
    }
  | { type: "skip"; githubLogin: string };

export interface MatchSuggestion {
  userId: number;
  userName: string;
  userEmail: string;
  userStatus: "active" | "inactive";
  githubUsername: string | null;
  score: number;
  reason: string;
}

export interface ResolutionSummary {
  total: number;
  imported: number;
  matched: number;
  created: number;
  skipped: number;
  unresolved: number;
}

// Copilot integration types
export type CopilotSyncType = "members" | "copilot";

export type CopilotUsageMetric = InferSelectModel<typeof copilotUsageMetrics>;
export type NewCopilotUsageMetric = InferInsertModel<typeof copilotUsageMetrics>;
export type CopilotBillingSnapshot = InferSelectModel<typeof copilotBillingSnapshots>;
export type NewCopilotBillingSnapshot = InferInsertModel<typeof copilotBillingSnapshots>;

export type CopilotSyncStatus = {
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "completed" | "partial" | "failed" | null;
  nextScheduledSync: string | null;
  dataRange: { earliest: string; latest: string } | null;
  recordCounts: {
    metrics: number;
    billing: number;
    seats: number;
  };
};

export interface CopilotOverviewData {
  totalSeats: number;
  activeSeats: number;
  pendingSeats: number;
  acceptanceRate: number;
  totalSuggestions: number;
  totalAcceptances: number;
  totalLinesSuggested: number;
  totalLinesAccepted: number;
  totalActiveUsers: number;
  trends: Array<{
    date: string;
    suggestions: number;
    acceptances: number;
    activeUsers: number;
    acceptanceRate: number;
  }>;
}

export interface CopilotSeatData {
  githubLogin: string;
  githubId: number;
  avatarUrl: string | null;
  assignedAt: string;
  lastActivityAt: string | null;
  lastActivityEditor: string | null;
  planType: "business" | "enterprise";
  status: "active" | "inactive" | "pending";
  matchedUserId: number | null;
  matchedUserName: string | null;
}

export interface CopilotSeatDetailData extends CopilotSeatData {
  activityTimeline: Array<{
    date: string;
    lastActivityAt: string | null;
    status: string;
  }>;
}

export interface CopilotBillingData {
  currentMonth: {
    totalCostCents: number;
    activeSeats: number;
    totalSeats: number;
    costPerActiveUserCents: number;
    planType: string;
  };
  cumulativeCostCents: number;
  trends: Array<{
    month: string;
    totalCostCents: number;
    totalSeats: number;
    activeSeats: number;
    costPerActiveUserCents: number;
  }>;
}

export interface CopilotAnalyticsData {
  byLanguage: Array<{
    language: string;
    suggestions: number;
    acceptances: number;
    acceptanceRate: number;
    linesSuggested: number;
    linesAccepted: number;
  }>;
  byEditor: Array<{
    editor: string;
    engagedUsers: number;
    suggestions: number;
    acceptances: number;
  }>;
  activityDistribution: {
    powerUsers: number;
    regularUsers: number;
    occasionalUsers: number;
    inactiveUsers: number;
  };
  utilizationTrend: Array<{
    date: string;
    activeUsers: number;
    totalSeats: number;
    utilizationRate: number;
  }>;
}

// Anthropic Usage Types (016-claude-api-costs)
export type DailyModelCost = {
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
};

export type DailyBreakdown = {
  date: string;
  models: DailyModelCost[];
  totalCents: number;
};

export type CostData = {
  available: boolean;
  error?: string;
  monthlyTotalCents: number;
  dailyBreakdown: DailyBreakdown[];
  latestDataDate: string | null;
  hasUnresolvedPricing: boolean;
};

export type ProfileData = {
  user: {
    id: number;
    name: string;
    email: string;
    role: "admin" | "viewer";
    circle: string | null;
    profile: "boost" | "maxed" | "indie" | null;
    discipline: UserDiscipline;
  };
  assignments: {
    id: number;
    toolName: string;
    tierName: string;
    assignedAt: Date;
    status: "active" | "inactive";
  }[];
  costData: CostData;
};

// 018-claude-global-metrics types
export type AnthropicWorkspace = InferSelectModel<typeof anthropicWorkspaces>;
export type NewAnthropicWorkspace = InferInsertModel<typeof anthropicWorkspaces>;
export type AnthropicWorkspaceCost = InferSelectModel<typeof anthropicWorkspaceCosts>;
export type NewAnthropicWorkspaceCost = InferInsertModel<typeof anthropicWorkspaceCosts>;
export type AnthropicWorkspaceLimit = InferSelectModel<typeof anthropicWorkspaceLimits>;
export type NewAnthropicWorkspaceLimit = InferInsertModel<typeof anthropicWorkspaceLimits>;
export type AnthropicOrgConfig = InferSelectModel<typeof anthropicOrgConfig>;
export type NewAnthropicOrgConfig = InferInsertModel<typeof anthropicOrgConfig>;

export interface GlobalCostDashboardData {
  grandTotalCents: number;
  dailyTotals: { date: string; costCents: number }[];
  workspaceBreakdown: {
    workspaceId: string | null;
    name: string;
    totalCents: number;
    dailyTotals: { date: string; costCents: number }[];
  }[];
}

// Spec 026 — Claude page redesign

export interface DashboardKpis {
  totalCents: number;
  momDeltaCents: number;
  momDeltaPct: number | null;
  projectedMonthEndCents: number;
  workspacesOverEightyCount: number;
  workspacesWithLimitCount: number;
  topOverWorkspaceName: string | null;
  topOverWorkspaceUtilizationPct: number | null;
  priorMonthCents: number;
}

export interface DailyStackedRow {
  date: string;
  perWorkspace: Record<string, number>;
  total: number;
}

export interface StackedSeries {
  key: string;
  name: string;
  color: string;
  isOther: boolean;
}

export interface SyncStatus {
  lastSyncedAt: Date | null;
  ageMinutes: number | null;
  isStale: boolean;
}

export interface TwelveMonthRow {
  month: string;
  totalCents: number;
  budgetLimitCents: number | null;
}

export interface PacingRow {
  dayOfMonth: number;
  current: number | null;
  m1: number | null;
  m2: number | null;
  m3: number | null;
}

export interface TopMover {
  workspaceId: string | null;
  name: string;
  priorCents: number;
  currentCents: number;
  deltaCents: number;
  deltaPct: number;
  direction: "up";
}

export interface WorkspaceSparkline {
  workspaceKey: string;
  months: { month: string; totalCents: number }[];
}

// Spec 026 — Phase 3 (workspace drill-through)

export interface WorkspaceUser {
  userId: number;
  email: string;
  name: string;
  costCents: number;
  requestCount: number;
}

export interface ModelBreakdownRow {
  modelName: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  /** Percentage of the enclosing entity's total cost (0–100). Renders as "% Workspace" or "% User" depending on the scope. */
  pct: number;
}

export interface WorkspaceDetail {
  workspace: {
    id: string | null;
    name: string;
    isDefault: boolean;
    displayColor: string | null;
  };
  month: string;
  currentMonthCents: number;
  priorMonthCents: number;
  limitCents: number | null;
  utilizationPct: number | null;
  projectedMonthEndCents: number;
  momDeltaCents: number;
  momDeltaPct: number | null;
  dailyTotals: { date: string; costCents: number }[];
  topUsers: WorkspaceUser[];
  modelBreakdown: ModelBreakdownRow[];
  availableMonths: string[];
}

export interface WorkspaceListItem {
  workspaceId: string | null;
  name: string;
  isDefault: boolean;
  isArchived: boolean;
  currentMonthCents: number;
  limitCents: number | null;
  utilizationPct: number | null;
  displayColor: string | null;
}

export interface WorkspaceAlert {
  workspaceId: string | null;
  name: string;
  utilizationPct: number;
  severity: "warning" | "critical";
}

export interface ActiveAlertsData {
  workspaceAlerts: WorkspaceAlert[];
  creditsLow: false;
  creditsCritical: false;
}

export type OrgCreditsStatus = { available: false; reason: string };

// Spec 027 — Claude Users sub-page

export interface UserListRow {
  userId: number;
  email: string;
  name: string;
  circle: string | null;
  profile: UserProfile | null;
  status: UserStatus;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceColor: string | null;
  hasApiKey: boolean;
  costCents: number;
  totalTokens: number;
  modelsUsed: number;
  lastActive: string | null;
  hasUnresolvedPricing: boolean;
}

export interface UsersDashboardKpis {
  // Active users this month + MoM delta
  activeUsersCurrent: number;
  activeUsersPrior: number;
  activeUsersDeltaPct: number | null;
  // Top spender (first row of the canonical query)
  topSpender: {
    userId: number;
    name: string;
    email: string;
    costCents: number;
    pctOfOrg: number;
  } | null;
  // Top-5 concentration % of org spend
  topFiveConcentrationPct: number | null;
  // Users with no API key (numerator + denominator)
  usersWithNoApiKey: number;
  usersWithNoApiKeyDenominator: number;
  // Echo the period so the UI can render the month label
  totalCents: number;
}

// Spec 027 — Phase 2 (distribution + sparklines + daily-by-user)

/** One bucket of the user cost-distribution histogram. */
export interface UserCostDistributionBucket {
  /** Matches `COST_DISTRIBUTION_BUCKETS[].key`. */
  key: "zero" | "lt1" | "lt10" | "lt50" | "lt100" | "gte100";
  label: string;
  /** Inclusive lower bound (cents). */
  minCents: number;
  /** Exclusive upper bound (cents); null when unbounded ($100+). */
  maxCents: number | null;
  userCount: number;
}

/** Per-user 6-month sparkline data point. */
export interface UserSparkline {
  /** `YYYY-MM`. */
  month: string;
  totalCents: number;
}

/** Fastest-growing-users chip data — parallels `TopMover`. */
export interface UserTopMover {
  userId: number;
  name: string;
  email: string;
  priorCents: number;
  recentCents: number;
  deltaPct: number;
}

/**
 * One day in the stacked "Daily spend by user" chart.
 *
 * Keys in `perUser` are either user ids (as decimal strings) for the
 * top-5 spenders this period, or the literal `"__other__"` for the
 * everyone-else bucket. Values are cents.
 */
export interface DailyByUserRow {
  date: string;
  perUser: Record<string, number>;
  total: number;
}

/** Shape returned by `getDailyTotalsByUser`. */
export interface DailyByUserResult {
  days: DailyByUserRow[];
  topUsers: {
    /** Decimal-stringified userId, or `"__other__"`. */
    key: string;
    userId: number | null;
    name: string;
    email: string | null;
    totalCents: number;
  }[];
}

// Spec 027 — Phase 3 (per-user drill-through)

/** One day in the per-user daily-cost chart. */
export interface UserDailyRow {
  date: string;
  costCents: number;
}

/**
 * One of the user's top-cost days in the selected month, with the dominant
 * model on that day (highest-cost model contribution).
 */
export interface UserTopDateRow {
  date: string;
  costCents: number;
  /** Model that contributed the largest share on this day, or null if unknown. */
  dominantModel: string | null;
}

/** Detail payload for the per-user drill-through route `/claude/users/[userId]`. */
export interface UserDetail {
  user: {
    id: number;
    name: string;
    email: string;
    circle: string | null;
    profile: UserProfile | null;
    status: UserStatus;
    role: UserRole;
  };
  workspace: {
    workspaceId: string | null;
    name: string | null;
    displayColor: string | null;
  };
  /** `YYYY-MM` of the selected month. */
  month: string;
  /** `YYYY-MM-01`. */
  periodStart: string;
  /** Last day of the selected month, `YYYY-MM-DD`. */
  periodEnd: string;
  currentMonthCents: number;
  priorMonthCents: number;
  momDeltaCents: number;
  /** Null when the prior month is below $1 (delta meaningless). */
  momDeltaPct: number | null;
  projectedMonthEndCents: number;
  /** One entry per day in the period; missing days padded to 0. */
  dailyTotals: UserDailyRow[];
  modelBreakdown: ModelBreakdownRow[];
  /** Up to 5 highest-cost days in the period. */
  topDates: UserTopDateRow[];
  /** Last 12 months including the current month. */
  twelveMonth: { month: string; totalCents: number }[];
  hasUnresolvedPricing: boolean;
  /** Months with data for this user, newest first — used by the month picker. */
  availableMonths: string[];
}
