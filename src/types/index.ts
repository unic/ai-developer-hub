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
} from "@/lib/db/schema";

// Action result type
export type ActionResult<T = void> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// User appearance preferences (stored as JSONB on users table)
export type UserPreferences = {
  theme: "light" | "dark" | "system";
  leanMode: boolean;
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
  circle: string;
  userCount: number;
  licenseCount: number;
  totalMonthlyCost: number;
}
