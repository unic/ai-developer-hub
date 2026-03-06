import { z } from "zod";

// Login
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// Tool
export const toolSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  vendor: z.string().min(1, "Vendor is required").max(255),
  description: z.string().max(5000).optional(),
  maxLicenses: z.number().int().min(0).optional(),
});

// Tier
export const tierSchema = z.object({
  toolId: z.number().int().positive(),
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(5000).optional(),
  monthlyCostCents: z.number().int().min(0, "Cost must be non-negative"),
});

// User
export const userSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address"),
  circle: z.string().max(100).optional(),
  role: z.enum(["admin", "viewer"]),
  githubUsername: z.string().max(255).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  profile: z.enum(["boost", "maxed", "indie"]).optional(),
});

// Bulk import user (no password — admin sets a temp one)
export const bulkImportUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address"),
  circle: z.string().max(100).optional(),
  role: z.enum(["admin", "viewer"]).optional(),
  githubUsername: z.string().max(255).optional(),
  profile: z.enum(["boost", "maxed", "indie"]).optional(),
});

// Assignment
export const assignmentSchema = z.object({
  userId: z.number().int().positive(),
  toolId: z.number().int().positive(),
  tierId: z.number().int().positive(),
});

// Budget
export const budgetSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  totalAmountCents: z.number().int().positive("Budget must be positive"),
  periodType: z.enum(["monthly", "quarterly"]),
});

// Budget allocation
export const budgetAllocationSchema = z.object({
  budgetId: z.number().int().positive(),
  allocations: z.array(
    z.object({
      periodId: z.number().int().positive(),
      plannedAmountCents: z
        .number()
        .int()
        .min(0, "Amount must be non-negative"),
    })
  ),
});

// Bulk import assignment row
export const bulkImportAssignmentRowSchema = z.object({
  email: z.string().email(),
  tool: z.string().min(1).max(255),
  tier: z.string().min(1).max(100),
  workspace: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  assignedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
    .refine((value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return false;
      const [y, m, d] = value.split("-").map(Number);
      return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
    }, { message: "Invalid calendar date" }),
});

// Update assignment (in-place edit)
export const updateAssignmentSchema = z.object({
  id: z.number().int().positive(),
  tierId: z.number().int().positive().optional(),
  assignedAt: z.string().optional(),
  workspace: z.string().max(200).optional(),
  apiKey: z
    .string()
    .max(500)
    .refine((val) => val === "" || val.trim().length > 0, { message: "API key cannot be blank" })
    .transform((val) => (val === "" ? val : val.trim()))
    .optional(),
});

// Assignment comment
export const assignmentCommentSchema = z.object({
  assignmentId: z.number().int().positive(),
  body: z.string().min(1, "Comment is required").max(2000, "Comment must be 2000 characters or less"),
});

// Billed cost (create)
export const billedCostSchema = z.object({
  periodId: z.number().int().positive(),
  amountCents: z.number().int().positive("Amount must be positive"),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  description: z.string().min(1, "Description is required").max(500),
  vendorReference: z.string().max(255).optional(),
});

// Billed cost (update)
export const updateBilledCostSchema = z.object({
  id: z.number().int().positive(),
  amountCents: z.number().int().positive("Amount must be positive").optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format").optional(),
  description: z.string().min(1).max(500).optional(),
  vendorReference: z.string().max(255).optional().nullable(),
});

// Billed cost (delete)
export const deleteBilledCostSchema = z.object({
  id: z.number().int().positive(),
});

// Update budget total
export const updateBudgetTotalSchema = z.object({
  budgetId: z.number().int().positive(),
  totalAmountCents: z.number().int().positive("Budget must be positive"),
});

// Update user (partial)
export const updateUserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  circle: z.string().max(100).optional().nullable(),
  role: z.enum(["admin", "viewer"]).optional(),
  githubUsername: z.string().max(255).optional(),
  profile: z.enum(["boost", "maxed", "indie"]).nullable().optional(),
});

// Update tool (partial)
export const updateToolSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  vendor: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  maxLicenses: z.number().int().min(0).nullable().optional(),
});

// Update tier (partial)
export const updateTierSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  monthlyCostCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// User preferences
export const userPreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  leanMode: z.boolean(),
});

// Type exports for form usage
export type LoginInput = z.infer<typeof loginSchema>;
export type ToolInput = z.infer<typeof toolSchema>;
export type TierInput = z.infer<typeof tierSchema>;
export type UserInput = z.infer<typeof userSchema>;
export type BulkImportUserInput = z.infer<typeof bulkImportUserSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;
export type BudgetAllocationInput = z.infer<typeof budgetAllocationSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type AssignmentCommentInput = z.infer<typeof assignmentCommentSchema>;
export type BilledCostInput = z.infer<typeof billedCostSchema>;
export type UpdateBilledCostInput = z.infer<typeof updateBilledCostSchema>;
export type BulkImportAssignmentRowInput = z.infer<typeof bulkImportAssignmentRowSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Invoice (create + extraction result)
export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(255),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine((v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const [y, m, day] = v.split("-").map(Number);
      return (
        d.getUTCFullYear() === y &&
        d.getUTCMonth() + 1 === m &&
        d.getUTCDate() === day
      );
    }, "Invalid calendar date"),
  amountCents: z.number().int().positive("Amount must be a positive integer (cents)"),
  blobUrl: z.string().url(),
  blobPathname: z.string().min(1),
});

export const invoiceExtractionResultSchema = z.object({
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  amountCents: z.number().int().positive().nullable(),
  confidence: z.object({
    invoiceNumber: z.enum(["high", "medium", "low"]),
    invoiceDate: z.enum(["high", "medium", "low"]),
    amountCents: z.enum(["high", "medium", "low"]),
  }),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceExtractionResult = z.infer<typeof invoiceExtractionResultSchema>;
