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

// Computed types for budget views
export type PeriodWithCosts = BudgetPeriod & {
  expectedSpendCents: number;
  billedTotalCents: number;
  billedEntries?: BilledCost[];
};

export type BudgetWithCosts = AnnualBudget & {
  periods: PeriodWithCosts[];
};
