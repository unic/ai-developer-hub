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

// Shared values for the discipline enum (032-user-disciplines).
const disciplineValues = ["developer", "conception", "business"] as const;

// User (create — no password, invite flow)
export const userSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address"),
  circle: z.string().max(100).optional(),
  role: z.enum(["admin", "viewer"]),
  discipline: z.enum(disciplineValues, {
    message: "Please select a discipline",
  }),
  githubUsername: z.string().max(255).optional(),
  profile: z.enum(["boost", "maxed", "indie"]).optional(),
});

// Setup password (invite flow)
export const setupPasswordSchema = z
  .object({
    token: z.string().min(1, "Token is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Bulk import user (no password — invite link flow)
export const bulkImportUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address"),
  circle: z.string().max(100).optional(),
  role: z.enum(["admin", "viewer"]).optional(),
  discipline: z.enum(disciplineValues).optional(),
  githubUsername: z.string().max(255).optional(),
  profile: z.enum(["boost", "maxed", "indie"]).optional(),
});

// Shared API key field validation
const apiKeyField = z
  .string()
  .max(500)
  .refine((val) => val === "" || val.trim().length > 0, {
    message: "API key cannot be blank",
  })
  .transform((val) => (val === "" ? val : val.trim()))
  .optional();

// Assignment
export const assignmentSchema = z.object({
  userId: z.number().int().positive(),
  toolId: z.number().int().positive(),
  tierId: z.number().int().positive(),
  workspace: z.string().max(200).optional(),
  apiKey: apiKeyField,
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
    }),
  ),
});

// Bulk import assignment row
export const bulkImportAssignmentRowSchema = z.object({
  email: z.string().email(),
  tool: z.string().min(1).max(255),
  tier: z.string().min(1).max(100),
  workspace: z.string().max(200).optional(),
  apiKey: apiKeyField,
  assignedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
    .refine(
      (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return false;
        const [y, m, d] = value.split("-").map(Number);
        return (
          date.getUTCFullYear() === y &&
          date.getUTCMonth() + 1 === m &&
          date.getUTCDate() === d
        );
      },
      { message: "Invalid calendar date" },
    ),
});

// Update assignment (in-place edit)
export const updateAssignmentSchema = z.object({
  id: z.number().int().positive(),
  tierId: z.number().int().positive().optional(),
  assignedAt: z.string().optional(),
  workspace: z.string().max(200).optional(),
  apiKey: apiKeyField,
});

// Assignment comment
export const assignmentCommentSchema = z.object({
  assignmentId: z.number().int().positive(),
  body: z
    .string()
    .min(1, "Comment is required")
    .max(2000, "Comment must be 2000 characters or less"),
});

// Billed cost (create)
export const billedCostSchema = z.object({
  periodId: z.number().int().positive(),
  amountCents: z.number().int().positive("Amount must be positive"),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  description: z.string().min(1, "Description is required").max(500),
  vendorReference: z.string().max(255).optional(),
});

// Billed cost (update)
export const updateBilledCostSchema = z.object({
  id: z.number().int().positive(),
  amountCents: z.number().int().positive("Amount must be positive").optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
    .optional(),
  description: z.string().min(1).max(500).optional(),
  vendorReference: z.string().max(255).optional().nullable(),
});

// Billed cost (delete)
export const deleteBilledCostSchema = z.object({
  id: z.number().int().positive(),
});

// ── Budget Extensions (spec 026) ─────────────────────────────────────────
// (The former updateBudgetTotalSchema was removed with the updateBudgetTotal
// action — ceiling changes now go through budget extensions only.)

export const budgetExtensionCategorySchema = z.enum([
  "new_tool",
  "scope_increase",
  "seat_increase",
  "vendor_price_increase",
  "reallocation",
  "other",
]);

/**
 * Discriminated union describing how the user wants the extension's
 * amount distributed across budget periods. The server uses this to
 * compute per-period deltas and write the join rows.
 */
export const budgetExtensionAllocationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unallocated") }),
  z.object({ mode: z.literal("distribute_remaining") }),
  z.object({
    mode: z.literal("single_period"),
    periodId: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal("custom"),
    allocations: z
      .array(
        z.object({
          periodId: z.number().int().positive(),
          amountCents: z.number().int(),
        }),
      )
      .min(1),
  }),
]);

/**
 * Postgres INTEGER (32-bit) max ≈ $21.4M. Cap individual extensions at $20M so
 * a budget total can fit a few of them without overflowing the column. Shared
 * with the dialog's client-side parser (extension-form.ts) so the UI can never
 * accept a value the server rejects — and vice versa.
 */
export const MAX_EXTENSION_CENTS = 2_000_000_000;

export const createBudgetExtensionSchema = z.object({
  budgetId: z.number().int().positive(),
  // Non-zero — positive extension or negative reduction. The DB has a
  // matching CHECK constraint as defense-in-depth.
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, { message: "Amount must be non-zero" })
    .refine((n) => Math.abs(n) <= MAX_EXTENSION_CENTS, {
      message: "Amount exceeds the maximum supported value",
    }),
  reason: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  category: budgetExtensionCategorySchema,
  linkedToolId: z.number().int().positive().optional(),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .refine(
      (s) => {
        // Reject calendar-invalid dates like "2026-13-99" or "2026-02-30"
        // that pass the regex but don't round-trip through Date.
        const d = new Date(`${s}T00:00:00Z`);
        return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
      },
      { message: "Date does not exist on the calendar" },
    ),
  allocation: budgetExtensionAllocationSchema,
});

export const updateBudgetExtensionSchema = z.object({
  extensionId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: budgetExtensionCategorySchema.optional(),
  // null = unset the tool link; undefined = leave unchanged
  linkedToolId: z.number().int().positive().nullable().optional(),
});

export const deleteBudgetExtensionSchema = z.object({
  extensionId: z.number().int().positive(),
});

// Update user (partial)
export const updateUserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  circle: z.string().max(100).optional().nullable(),
  role: z.enum(["admin", "viewer"]).optional(),
  discipline: z.enum(disciplineValues).optional(),
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
});

// API Preview (profile API testing)
export const apiPreviewEmailSchema = z.string().email("Invalid email format");
export const apiPreviewMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month format. Expected YYYY-MM.");
export const apiPreviewSchema = z.object({
  email: apiPreviewEmailSchema,
  month: apiPreviewMonthSchema.optional(),
});

// Type exports for form usage
export type LoginInput = z.infer<typeof loginSchema>;
export type ToolInput = z.infer<typeof toolSchema>;
export type TierInput = z.infer<typeof tierSchema>;
export type UserInput = z.infer<typeof userSchema>;
export type BulkImportUserInput = z.infer<typeof bulkImportUserSchema>;
export type SetupPasswordInput = z.infer<typeof setupPasswordSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;
export type BudgetAllocationInput = z.infer<typeof budgetAllocationSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type AssignmentCommentInput = z.infer<typeof assignmentCommentSchema>;
export type BilledCostInput = z.infer<typeof billedCostSchema>;
export type UpdateBilledCostInput = z.infer<typeof updateBilledCostSchema>;
export type BulkImportAssignmentRowInput = z.infer<
  typeof bulkImportAssignmentRowSchema
>;
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
  amountCents: z
    .number()
    .int()
    .positive("Amount must be a positive integer (cents)"),
  vendor: z.string().max(255).optional(),
  blobUrl: z.string().url(),
  blobPathname: z.string().min(1),
});

export const invoiceExtractionResultSchema = z.object({
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  amountCents: z.number().int().positive().nullable(),
  vendor: z.string().nullable(),
  confidence: z.object({
    invoiceNumber: z.enum(["high", "medium", "low"]),
    invoiceDate: z.enum(["high", "medium", "low"]),
    amountCents: z.enum(["high", "medium", "low"]),
    vendor: z.enum(["high", "medium", "low"]),
  }),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceExtractionResult = z.infer<
  typeof invoiceExtractionResultSchema
>;

// Invoice sync schemas
export const syncOptionsSchema = z.object({
  dryRun: z.boolean(),
});

// GitHub integration validators
export const githubTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const connectOrgSchema = z.object({
  token: z.string().min(1, "Token is required"),
  orgLogin: z.string().min(1, "Organization login is required"),
  orgId: z.number().int().positive(),
});

export const manualMatchSchema = z.object({
  githubLogin: z.string().min(1),
  userId: z.number().int().positive(),
});

export const inlineUserCreationSchema = z.object({
  githubLogin: z.string().min(1),
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address"),
  discipline: z.enum(disciplineValues, {
    message: "Please select a discipline",
  }),
});

export const confirmSyncSchema = z.object({
  importGitHubLogins: z.array(z.string()),
  manualMatches: z.array(manualMatchSchema).optional().default([]),
  newUsers: z.array(inlineUserCreationSchema).optional().default([]),
});

export type GitHubTokenInput = z.infer<typeof githubTokenSchema>;
export type ConnectOrgInput = z.infer<typeof connectOrgSchema>;
export type ConfirmSyncInput = z.infer<typeof confirmSyncSchema>;
export type ManualMatchInput = z.infer<typeof manualMatchSchema>;
export type InlineUserCreationInput = z.infer<typeof inlineUserCreationSchema>;

// Copilot integration validators
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
  .refine((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const [y, m, d] = value.split("-").map(Number);
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    );
  }, "Invalid calendar date");

export const copilotDateRangeSchema = z.object({
  since: calendarDateSchema.optional(),
  until: calendarDateSchema.optional(),
});

export const copilotSeatFilterSchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  sortBy: z.enum(["lastActivity", "assignedAt", "name"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const copilotSeatDetailSchema = z.object({
  githubId: z.number().int().positive(),
});

export type CopilotDateRangeInput = z.infer<typeof copilotDateRangeSchema>;
export type CopilotSeatFilterInput = z.infer<typeof copilotSeatFilterSchema>;
export type CopilotSeatDetailInput = z.infer<typeof copilotSeatDetailSchema>;
export type ApiPreviewInput = z.infer<typeof apiPreviewSchema>;

// Ingestion filter value schemas (024-ingestion-filter)
export const vendorFilterValueSchema = z.object({
  values: z
    .array(z.string().min(1, "Value cannot be empty").max(255))
    .min(1, "At least one vendor value is required"),
});

export const invoiceNumberFilterValueSchema = z.object({
  pattern: z
    .string()
    .min(1, "Pattern is required")
    .max(500, "Pattern must be 500 characters or less")
    .refine(
      (val) => {
        try {
          new RegExp(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid regular expression pattern" },
    ),
});

export const createIngestionFilterSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    field: z.enum(["vendor", "invoice_number"]),
    mode: z.enum(["whitelist", "blacklist"]),
    value: z.union([vendorFilterValueSchema, invoiceNumberFilterValueSchema]),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.field === "vendor") return "values" in data.value;
      if (data.field === "invoice_number") return "pattern" in data.value;
      return false;
    },
    { message: "Value shape must match the selected field type" },
  );

export const updateIngestionFilterSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(255).optional(),
    field: z.enum(["vendor", "invoice_number"]).optional(),
    mode: z.enum(["whitelist", "blacklist"]).optional(),
    value: z
      .union([vendorFilterValueSchema, invoiceNumberFilterValueSchema])
      .optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.value === undefined) return true;
      if (!data.field) return false;
      if (data.field === "vendor") return "values" in data.value;
      if (data.field === "invoice_number") return "pattern" in data.value;
      return false;
    },
    {
      message:
        "When updating value, field must be provided and value shape must match the field type",
    },
  );

export const deleteIngestionFilterSchema = z.object({
  id: z.number().int().positive(),
});

export type VendorFilterValue = z.infer<typeof vendorFilterValueSchema>;
export type InvoiceNumberFilterValue = z.infer<
  typeof invoiceNumberFilterValueSchema
>;
export type CreateIngestionFilterInput = z.infer<
  typeof createIngestionFilterSchema
>;
export type UpdateIngestionFilterInput = z.infer<
  typeof updateIngestionFilterSchema
>;

// License Request — spec 032-automation-workflow
//
// Power Automate POSTs this payload to /api/license-requests/ingest after a
// Microsoft Form is submitted. PA sends tool / tier by NAME (what the form
// shows the requester) and the Hub resolves to IDs — Form display values
// don't change as often as DB IDs, so name-matching is the more stable contract.
export const licenseRequestIngestSchema = z
  .object({
    formResponseId: z.string().min(1).max(255),
    requesterEmail: z.string().email(),
    requesterName: z.string().min(1).max(255),
    // v2 contract (032-v2): the Form sends role + profile; the Hub derives the
    // tool via the tool_mappings table. Empty profile = baseline. Matching is
    // case-insensitive — the Form's answer options are Title Case
    // ("Development", "Maxed") and PA forwards them verbatim.
    role: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
        z.enum(["development", "conception", "business"]),
      )
      .optional(),
    profile: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
        z.union([z.literal(""), z.literal("maxed"), z.literal("indie")]),
      )
      .optional(),
    justification: z.string().max(4000).optional(),
    // Legacy v1 contract — tool/tier by name or id. Accepted only when `role`
    // is absent, so an un-updated Power Automate flow keeps working during the
    // switchover. Ignored when `role` is present.
    toolId: z.number().int().positive().optional(),
    toolName: z.string().min(1).max(255).optional(),
    tierId: z.number().int().positive().optional(),
    tierName: z.string().min(1).max(255).optional(),
    // Raw form payload. v2: keyed by question label (PA maps question text);
    // v1 legacy rows carry MS Forms field-ID hashes.
    formPayload: z.record(z.string(), z.unknown()),
    // Teams context — stored for the future stack's Teams integration; the
    // Hub does not post anything itself (Graph path dormant since 032-v2).
    teamsTeamId: z.string().min(1),
    teamsChannelId: z.string().min(1),
    teamsParentMessageId: z.string().min(1),
    teamsChatId: z.string().min(1),
  })
  .superRefine((d, ctx) => {
    if (d.role === undefined && d.toolId === undefined && !d.toolName) {
      ctx.addIssue({
        code: "custom",
        message: "role (v2) or toolId/toolName (legacy) is required",
        path: ["role"],
      });
    }
    // Justification is a v2-contract rule — only enforce it when the caller
    // is actually on the v2 branch (role present). A partially updated legacy
    // caller sending a stray profile must not start failing.
    if (
      d.role !== undefined &&
      (d.profile === "maxed" || d.profile === "indie")
    ) {
      if (!d.justification || d.justification.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `justification is required when profile is "${d.profile}"`,
          path: ["justification"],
        });
      }
    }
  });

export type LicenseRequestIngestInput = z.infer<
  typeof licenseRequestIngestSchema
>;

// 032-v2: (role, profile) → tool mapping rows. role null = any role;
// toolId null = "needs decision" (approver picks on the request).
export const toolMappingSchema = z
  .object({
    role: z.enum(["developer", "conception", "business"]).nullable(),
    profile: z.enum(["baseline", "maxed", "indie"]),
    toolId: z.number().int().positive().nullable(),
    defaultTierId: z.number().int().positive().nullable(),
  })
  .refine((d) => d.toolId !== null || d.defaultTierId === null, {
    message: "A default tier needs a tool",
    path: ["defaultTierId"],
  });
export type ToolMappingInput = z.infer<typeof toolMappingSchema>;

export const messageTemplateSchema = z.object({
  toolId: z.number().int().positive(),
  // null = tool-wide default; positive integer = tier-specific override.
  tierId: z.number().int().positive().nullable(),
  kind: z.enum(["approval", "completion"]),
  bodyMd: z.string().min(1).max(8000),
});

export type MessageTemplateInput = z.infer<typeof messageTemplateSchema>;

// 032-v2: approving creates the assignment (provision-first — the admin has
// already done the vendor-side work). toolId is the derived tool, an override,
// or the indie pick; licenseCode is enforced server-side for requires_api_key
// tools (needs a tool lookup, so not expressible here).
//
// 042: a discriminated union rather than a flat `mode` flag, deliberately.
// loadToolAndTier runs before the transaction and hard-errors when a
// requires_api_key tool arrives without a licenseCode — so create-only rules
// have to be unreachable from the other modes, not merely skipped. Claude
// Console is the only requires_api_key tool and has the deepest tier ladder,
// i.e. exactly the upgrades a shared shape would have broken.
const approveCreateSchema = z.object({
  mode: z.literal("create"),
  requestId: z.number().int().positive(),
  toolId: z.number().int().positive(),
  tierId: z.number().int().positive(),
  assignedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD"),
  licenseCode: z.string().min(1).max(700).optional(),
  bodyMd: z.string().min(1).max(8000),
});

// Retier the seat the requester already holds. No assignedAt: that is the
// seat's original start and an upgrade must not rewrite it. licenseCode stays
// optional — the stored key is preserved, but the approval message may still
// need the token resolved for the copy-paste snippet.
const approveChangeTierSchema = z.object({
  mode: z.literal("change_tier"),
  requestId: z.number().int().positive(),
  assignmentId: z.number().int().positive(),
  toolId: z.number().int().positive(),
  tierId: z.number().int().positive(),
  licenseCode: z.string().min(1).max(700).optional(),
  bodyMd: z.string().min(1).max(8000),
});

// Approve and link an already-provisioned seat, mutating nothing. The only
// approvable outcome for sync-managed tools (GitHub owns the entitlement), and
// the escape hatch for the legacy v1 record-assignment path.
const approveLinkExistingSchema = z.object({
  mode: z.literal("link_existing"),
  requestId: z.number().int().positive(),
  assignmentId: z.number().int().positive(),
  bodyMd: z.string().min(1).max(8000),
});

export const approveRequestSchema = z.discriminatedUnion("mode", [
  approveCreateSchema,
  approveChangeTierSchema,
  approveLinkExistingSchema,
]);
export type ApproveRequestInput = z.infer<typeof approveRequestSchema>;
export type ApproveRequestMode = ApproveRequestInput["mode"];

// 032-v2: legacy migration path — attach the missing assignment to a request
// approved under v1 semantics (status approved, assignment_id NULL). No
// message, no re-approval.
export const recordAssignmentSchema = z.object({
  requestId: z.number().int().positive(),
  toolId: z.number().int().positive(),
  tierId: z.number().int().positive(),
  assignedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD"),
  licenseCode: z.string().min(1).max(700).optional(),
});
export type RecordAssignmentInput = z.infer<typeof recordAssignmentSchema>;

// 042: the legacy record-assignment path's missing case. recordAssignment can
// only CREATE, so a v1-approved request whose requester already holds the tool
// was permanently stuck — the create hits the duplicate-seat guard, and
// approveRequest cannot help because it requires status='pending_review' while
// this row is already 'approved'. This links the seat that already exists.
export const linkExistingAssignmentSchema = z.object({
  requestId: z.number().int().positive(),
  assignmentId: z.number().int().positive(),
});
export type LinkExistingAssignmentInput = z.infer<
  typeof linkExistingAssignmentSchema
>;

export const rejectRequestSchema = z.object({
  requestId: z.number().int().positive(),
  decisionNote: z.string().min(1).max(2000),
});
export type RejectRequestInput = z.infer<typeof rejectRequestSchema>;

export const cancelRequestSchema = z.object({
  requestId: z.number().int().positive(),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

// Forecast Scenarios — spec 041-forecast-scenario-persistence
//
// Boundary schemas for the forecast_scenarios jsonb params column. Plain
// z.object (strip semantics): unknown keys are dropped rather than rejected,
// so rows stay loadable across schema evolution; writes store parsed.data,
// keeping the stored shape canonical. Zod 4's z.number() rejects NaN/Infinity
// by default, so nothing non-finite can reach the projection engine's math.
// Bounds are generous modelling limits, not business rules.
export const toolParamsSchema = z.object({
  include: z.boolean(),
  model: z.enum(["flat", "linear", "compound"]),
  val: z.number().min(-100_000).max(100_000),
  burnPct: z.number().min(-100).max(100_000).optional(),
  burnCap: z.number().int().min(0).max(100_000_000).optional(),
  premShare: z.number().min(0).max(1).optional(),
  billing: z.enum(["monthly", "yearly"]).optional(),
});

export const forecastInputsSchema = z
  .object({
    // ≤ $1B; 0 is accepted (the save dialog guards the accidental-empty path).
    ceilingCents: z.number().int().min(0).max(100_000_000_000),
    tools: z.record(z.string().min(1).max(40), toolParamsSchema),
  })
  .refine((v) => Object.keys(v.tools).length <= 20, {
    message: "Too many tool entries",
  });

const forecastScenarioNameSchema = z.string().trim().min(1).max(60);

export const createForecastScenarioSchema = z.object({
  name: forecastScenarioNameSchema,
  params: forecastInputsSchema,
});
export const updateForecastScenarioSchema = z.object({
  id: z.number().int().positive(),
  name: forecastScenarioNameSchema,
  // Omitted = rename-only; stored params stay untouched.
  params: forecastInputsSchema.optional(),
});
export const deleteForecastScenarioSchema = z.object({
  id: z.number().int().positive(),
});
