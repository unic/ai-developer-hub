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
  githubSyncEvents,
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

export interface ToolUtilization {
  toolId: number;
  toolName: string;
  vendor: string;
  assignedCount: number;
  maxLicenses: number | null;
  utilizationPct: number;
  expectedMonthlyCents: number;
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
}

export interface ForecastChartPoint {
  month: string;
  historical: number | null;
  projected: number | null;
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
export type GitHubSyncStatus = "in_progress" | "completed" | "partial" | "failed";

export type GitHubConnection = InferSelectModel<typeof githubConnections>;
export type NewGitHubConnection = InferInsertModel<typeof githubConnections>;
export type GitHubProfile = InferSelectModel<typeof githubProfiles>;
export type NewGitHubProfile = InferInsertModel<typeof githubProfiles>;
export type GitHubSyncEvent = InferSelectModel<typeof githubSyncEvents>;
export type NewGitHubSyncEvent = InferInsertModel<typeof githubSyncEvents>;

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
  | { type: "create"; githubLogin: string; name: string; email: string }
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
