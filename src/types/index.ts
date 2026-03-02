import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  users,
  aiTools,
  accessTiers,
  licenseAssignments,
  annualBudgets,
  budgetPeriods,
  changeHistory,
} from "@/lib/db/schema";

// Action result type
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

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

// Insert types (for writing to DB)
export type NewUser = InferInsertModel<typeof users>;
export type NewAiTool = InferInsertModel<typeof aiTools>;
export type NewAccessTier = InferInsertModel<typeof accessTiers>;
export type NewLicenseAssignment = InferInsertModel<typeof licenseAssignments>;
export type NewAnnualBudget = InferInsertModel<typeof annualBudgets>;
export type NewBudgetPeriod = InferInsertModel<typeof budgetPeriods>;
export type NewChangeHistory = InferInsertModel<typeof changeHistory>;
