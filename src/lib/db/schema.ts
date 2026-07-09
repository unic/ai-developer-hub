import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import type { UserPreferences, IngestionDetails } from "@/types";
import type { ForecastInputs } from "@/lib/scenarios/budget-forecast";
import { relations, sql } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "viewer"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const toolStatusEnum = pgEnum("tool_status", ["active", "archived"]);
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "active",
  "inactive",
]);
export const budgetStatusEnum = pgEnum("budget_status", ["active", "archived"]);
export const periodTypeEnum = pgEnum("period_type", ["monthly", "quarterly"]);
export const budgetExtensionCategoryEnum = pgEnum("budget_extension_category", [
  "new_tool",
  "scope_increase",
  "seat_increase",
  "vendor_price_increase",
  "reallocation",
  "other",
]);
export const changeTypeEnum = pgEnum("change_type", [
  "created",
  "updated",
  "deleted",
  "status_change",
]);
export const userProfileEnum = pgEnum("user_profile", [
  "boost",
  "maxed",
  "indie",
]);
export const userDisciplineEnum = pgEnum("user_discipline", [
  "developer",
  "conception",
  "business",
]);
export const githubConnectionStatusEnum = pgEnum("github_connection_status", [
  "active",
  "disconnected",
]);
export const githubSyncStatusEnum = pgEnum("github_sync_status", [
  "in_progress",
  "completed",
  "partial",
  "failed",
]);
export const copilotSyncTypeEnum = pgEnum("copilot_sync_type", [
  "members",
  "copilot",
]);
export const inviteTokenStatusEnum = pgEnum("invite_token_status", [
  "active",
  "consumed",
  "invalidated",
]);

// Ingestion filter enums (024-ingestion-filter)
export const filterFieldEnum = pgEnum("filter_field", [
  "vendor",
  "invoice_number",
]);

export const filterModeEnum = pgEnum("filter_mode", ["whitelist", "blacklist"]);

// Ingestion log enums (023-ingestion-history)
export const ingestionOutcomeEnum = pgEnum("ingestion_outcome", [
  "success",
  "failed",
  "filtered",
]);

export const ingestionChannelEnum = pgEnum("ingestion_channel", [
  "manual",
  "api",
  "bulk",
]);

// Ingestion type discriminator (034-ingestion-types-distinction)
export const ingestionKindEnum = pgEnum("ingestion_kind", [
  "invoice",
  "license_request",
  "user_import",
  "other",
]);

export const ingestionSourceTypeEnum = pgEnum("ingestion_source_type", [
  "invoice_pdf",
  "ms_forms_license_request",
  "csv_user_import",
]);

// Sync framework enums (019-invoice-automations)
export const syncSourceTypeEnum = pgEnum("sync_source_type", [
  "github_copilot_billing",
  "anthropic_api_usage",
  "anthropic_team_invoices",
  "github_members",
  "invoice_period_matching",
  "anthropic_api_costs",
]);

export const syncOutcomeEnum = pgEnum("sync_outcome", [
  "in_progress",
  "success",
  "partial",
  "failed",
]);

export const syncOperationTypeEnum = pgEnum("sync_operation_type", [
  "regular",
  "backfill",
]);

// License request enums (032-automation-workflow)
export const licenseRequestStatusEnum = pgEnum("license_request_status", [
  "pending_review",
  "approved",
  "rejected",
  "completed",
  "cancelled",
]);

export const messageTemplateKindEnum = pgEnum("message_template_kind", [
  "approval",
  "completion",
]);
// Request profile vocabulary (032-v2). Deliberately separate from
// user_profile: that enum carries the retired "boost" and lacks "baseline".
export const licenseRequestProfileEnum = pgEnum("license_request_profile", [
  "baseline",
  "maxed",
  "indie",
]);

// Users
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    githubUsername: varchar("github_username", { length: 255 }),
    circle: varchar("circle", { length: 100 }),
    role: userRoleEnum("role").notNull().default("viewer"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    preferences: jsonb("preferences")
      .$type<UserPreferences>()
      .default({ theme: "system" }),
    profile: userProfileEnum("profile"),
    discipline: userDisciplineEnum("discipline").notNull().default("developer"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    isAgent: boolean("is_agent").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_circle_idx").on(table.circle),
    index("users_status_idx").on(table.status),
  ],
);

// Invite Tokens
export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    status: inviteTokenStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    consumedAt: timestamp("consumed_at"),
  },
  (table) => [
    index("invite_tokens_token_hash_idx").on(table.tokenHash),
    index("invite_tokens_user_id_idx").on(table.userId),
    // Enforce one active invite token per user at the DB level.
    // The application also enforces this in createInviteTokenForUser (src/actions/invite.ts)
    // by invalidating prior active tokens before inserting a new one.
    uniqueIndex("invite_tokens_active_user_idx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
);

// AI Tools
export const aiTools = pgTable(
  "ai_tools",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    vendor: varchar("vendor", { length: 255 }).notNull(),
    description: text("description"),
    maxLicenses: integer("max_licenses"),
    status: toolStatusEnum("status").notNull().default("active"),
    // Assignments for this tool carry a credential (e.g. Claude Console API
    // keys). Drives the required key field in the request approval dialog.
    requiresApiKey: boolean("requires_api_key").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_tools_name_idx").on(table.name),
    index("ai_tools_vendor_idx").on(table.vendor),
  ],
);

// Access Tiers
export const accessTiers = pgTable(
  "access_tiers",
  {
    id: serial("id").primaryKey(),
    toolId: integer("tool_id")
      .notNull()
      .references(() => aiTools.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    monthlyCostCents: integer("monthly_cost_cents").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("access_tiers_tool_id_idx").on(table.toolId),
    uniqueIndex("access_tiers_tool_name_idx").on(table.toolId, table.name),
  ],
);

// License Assignments
export const licenseAssignments = pgTable(
  "license_assignments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => aiTools.id, { onDelete: "restrict" }),
    tierId: integer("tier_id")
      .notNull()
      .references(() => accessTiers.id, { onDelete: "restrict" }),
    costAtAssignmentCents: integer("cost_at_assignment_cents").notNull(),
    status: assignmentStatusEnum("status").notNull().default("active"),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    workspace: varchar("workspace", { length: 200 }),
    apiKeyEncrypted: varchar("api_key_encrypted", { length: 700 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    source: varchar("source", { length: 50 }).notNull().default("manual"),
  },
  (table) => [
    index("license_assignments_user_id_idx").on(table.userId),
    index("license_assignments_tool_id_idx").on(table.toolId),
    index("license_assignments_tier_id_idx").on(table.tierId),
    index("license_assignments_status_idx").on(table.status),
    index("license_assignments_active_lookup_idx").on(
      table.userId,
      table.toolId,
      table.status,
    ),
  ],
);

// Annual Budgets
export const annualBudgets = pgTable(
  "annual_budgets",
  {
    id: serial("id").primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    // The live, effective ceiling. Mutated by createBudgetExtension /
    // deleteBudgetExtension so existing read sites stay accurate without churn.
    totalAmountCents: integer("total_amount_cents").notNull(),
    // The originally approved ceiling. Set at create time, never mutated.
    // Effective ceiling - original = net extension delta.
    originalAmountCents: integer("original_amount_cents").notNull(),
    periodType: periodTypeEnum("period_type").notNull(),
    status: budgetStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("annual_budgets_fiscal_year_idx").on(table.fiscalYear),
    index("annual_budgets_status_idx").on(table.status),
  ],
);

// Budget Periods
export const budgetPeriods = pgTable(
  "budget_periods",
  {
    id: serial("id").primaryKey(),
    budgetId: integer("budget_id")
      .notNull()
      .references(() => annualBudgets.id, { onDelete: "cascade" }),
    periodLabel: varchar("period_label", { length: 20 }).notNull(),
    periodIndex: integer("period_index").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    plannedAmountCents: integer("planned_amount_cents").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("budget_periods_budget_id_idx").on(table.budgetId),
    uniqueIndex("budget_periods_budget_period_idx").on(
      table.budgetId,
      table.periodIndex,
    ),
  ],
);

// Budget Extensions — first-class record of mid-year ceiling changes.
// Each row records a delta to annual_budgets.totalAmountCents with a reason,
// category, and optional tool attribution. See specs/026-budget-extensions/.
export const budgetExtensions = pgTable(
  "budget_extensions",
  {
    id: serial("id").primaryKey(),
    budgetId: integer("budget_id")
      .notNull()
      .references(() => annualBudgets.id, { onDelete: "cascade" }),
    // Non-zero. Positive = extension, negative = reduction. App-level
    // validation enforces non-zero (Drizzle/Postgres doesn't have an easy
    // way to express that without a CHECK constraint, but we add one below).
    amountCents: integer("amount_cents").notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    description: text("description"),
    category: budgetExtensionCategoryEnum("category").notNull(),
    linkedToolId: integer("linked_tool_id").references(() => aiTools.id, {
      onDelete: "set null",
    }),
    effectiveDate: date("effective_date").notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("budget_extensions_budget_idx").on(table.budgetId),
    index("budget_extensions_effective_idx").on(table.effectiveDate),
    index("budget_extensions_linked_tool_idx").on(table.linkedToolId),
    index("budget_extensions_created_by_idx").on(table.createdBy),
    check("budget_extensions_amount_non_zero", sql`${table.amountCents} <> 0`),
  ],
);

// Budget Extension Period Allocations — which periods absorbed an extension.
// One row per (extension, period) with the contribution amount. Powers the
// "+€X from extension" sub-label and lets delete cleanly reverse the impact.
export const budgetExtensionPeriodAllocations = pgTable(
  "budget_extension_period_allocations",
  {
    id: serial("id").primaryKey(),
    extensionId: integer("extension_id")
      .notNull()
      .references(() => budgetExtensions.id, { onDelete: "cascade" }),
    periodId: integer("period_id")
      .notNull()
      .references(() => budgetPeriods.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bepa_unique_ext_period").on(table.extensionId, table.periodId),
    index("bepa_period_idx").on(table.periodId),
  ],
);

// Change History
export const changeHistory = pgTable(
  "change_history",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: integer("entity_id").notNull(),
    changeType: changeTypeEnum("change_type").notNull(),
    fieldName: varchar("field_name", { length: 100 }),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    changedBy: integer("changed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("change_history_entity_idx").on(table.entityType, table.entityId),
    index("change_history_changed_by_idx").on(table.changedBy),
    index("change_history_created_at_idx").on(table.createdAt),
  ],
);

// Assignment Comments
export const assignmentComments = pgTable(
  "assignment_comments",
  {
    id: serial("id").primaryKey(),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => licenseAssignments.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: varchar("body", { length: 2000 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("assignment_comments_assignment_id_idx").on(table.assignmentId),
    index("assignment_comments_author_id_idx").on(table.authorId),
    index("assignment_comments_created_at_idx").on(table.createdAt),
  ],
);

// Billed Costs
export const billedCosts = pgTable(
  "billed_costs",
  {
    id: serial("id").primaryKey(),
    periodId: integer("period_id")
      .notNull()
      .references(() => budgetPeriods.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    vendorReference: varchar("vendor_reference", { length: 255 })
      .notNull()
      .default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("billed_costs_period_id_idx").on(table.periodId),
    index("billed_costs_invoice_date_idx").on(table.invoiceDate),
  ],
);

// Invoices
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 255 }).notNull(),
    invoiceDate: date("invoice_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    vendor: varchar("vendor", { length: 255 }),
    linkedBilledCostId: integer("linked_billed_cost_id").references(
      () => billedCosts.id,
      { onDelete: "set null" },
    ),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    filteredOut: boolean("filtered_out").notNull().default(false),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("invoices_invoice_number_idx").on(t.invoiceNumber),
    index("invoices_created_at_idx").on(t.createdAt),
    index("invoices_linked_billed_cost_id_idx").on(t.linkedBilledCostId),
  ],
);

// GitHub Connections
export const githubConnections = pgTable(
  "github_connections",
  {
    id: serial("id").primaryKey(),
    orgLogin: varchar("org_login", { length: 255 }).notNull(),
    orgId: integer("org_id").notNull(),
    orgAvatarUrl: varchar("org_avatar_url", { length: 500 }),
    tokenEncrypted: varchar("token_encrypted", { length: 700 }).notNull(),
    tokenScopesCsv: varchar("token_scopes_csv", { length: 255 }).notNull(),
    status: githubConnectionStatusEnum("status").notNull().default("active"),
    connectedBy: integer("connected_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at"),
    lastSyncAt: timestamp("last_sync_at"),
    copilotSyncEnabled: boolean("copilot_sync_enabled")
      .notNull()
      .default(false),
    copilotSyncSchedule: varchar("copilot_sync_schedule", { length: 50 })
      .notNull()
      .default("daily"),
  },
  (table) => [index("github_connections_status_idx").on(table.status)],
);

// GitHub Profiles
export const githubProfiles = pgTable(
  "github_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    githubId: integer("github_id").notNull(),
    githubLogin: varchar("github_login", { length: 255 }).notNull(),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    bio: text("bio"),
    publicRepos: integer("public_repos"),
    profileUrl: varchar("profile_url", { length: 500 }),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("github_profiles_user_id_idx").on(table.userId),
    index("github_profiles_github_id_idx").on(table.githubId),
    index("github_profiles_github_login_idx").on(table.githubLogin),
  ],
);

// GitHub Sync Events
export const githubSyncEvents = pgTable(
  "github_sync_events",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => githubConnections.id, { onDelete: "cascade" }),
    triggeredBy: integer("triggered_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: githubSyncStatusEnum("status").notNull(),
    totalMembers: integer("total_members"),
    matchedCount: integer("matched_count"),
    importedCount: integer("imported_count"),
    unmatchedCount: integer("unmatched_count"),
    conflictCount: integer("conflict_count"),
    manuallyMatchedCount: integer("manually_matched_count"),
    createdCount: integer("created_count"),
    errorMessage: text("error_message"),
    syncType: copilotSyncTypeEnum("sync_type").notNull().default("members"),
    seatsProcessed: integer("seats_processed"),
    metricsProcessed: integer("metrics_processed"),
    billingProcessed: integer("billing_processed"),
    billingLinked: integer("billing_linked"),
    billingSkipped: integer("billing_skipped"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("github_sync_events_connection_id_idx").on(table.connectionId),
    index("github_sync_events_triggered_by_idx").on(table.triggeredBy),
  ],
);

// Copilot Usage Metrics
export const copilotUsageMetrics = pgTable(
  "copilot_usage_metrics",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => githubConnections.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    totalActiveUsers: integer("total_active_users").notNull(),
    totalEngagedUsers: integer("total_engaged_users").notNull(),
    totalSuggestions: integer("total_suggestions").notNull(),
    totalAcceptances: integer("total_acceptances").notNull(),
    totalLinesSuggested: integer("total_lines_suggested").notNull(),
    totalLinesAccepted: integer("total_lines_accepted").notNull(),
    totalChatTurns: integer("total_chat_turns"),
    totalChatAcceptances: integer("total_chat_acceptances"),
    // Deprecated 2026-04-02: GitHub removed the dotcom-chat and PR-summary counters
    // from the new Copilot usage metrics API. Columns retained for historical rows.
    totalDotcomChatTurns: integer("total_dotcom_chat_turns"),
    totalPrSummaries: integer("total_pr_summaries"),
    languageBreakdown: jsonb("language_breakdown"),
    editorBreakdown: jsonb("editor_breakdown"),
    // Added 2026-05-21 for new Copilot usage metrics API. See spec 031.
    usedCli: boolean("used_cli"),
    usedAgent: boolean("used_agent"),
    agentEditCount: integer("agent_edit_count"),
    cliBreakdown: jsonb("cli_breakdown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("copilot_usage_metrics_connection_date_idx").on(
      table.connectionId,
      table.date,
    ),
    index("copilot_usage_metrics_date_idx").on(table.date),
  ],
);

// Copilot Billing Snapshots
export const copilotBillingSnapshots = pgTable(
  "copilot_billing_snapshots",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => githubConnections.id, { onDelete: "cascade" }),
    billingMonth: date("billing_month").notNull(),
    planType: varchar("plan_type", { length: 50 }).notNull(),
    totalSeats: integer("total_seats").notNull(),
    activeSeats: integer("active_seats").notNull(),
    seatCostCents: integer("seat_cost_cents").notNull(),
    totalCostCents: integer("total_cost_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("copilot_billing_snapshots_connection_month_idx").on(
      table.connectionId,
      table.billingMonth,
    ),
  ],
);

// Anthropic Usage Metrics (daily token usage per user per model)
export const anthropicUsageMetrics = pgTable(
  "anthropic_usage_metrics",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    uncachedInputTokens: bigint("uncached_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cacheCreationInputTokens: bigint("cache_creation_input_tokens", {
      mode: "number",
    })
      .notNull()
      .default(0),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    computedCostCents: integer("computed_cost_cents").notNull().default(0),
    pricingResolved: boolean("pricing_resolved").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anthropic_usage_metrics_user_date_model_idx").on(
      table.userId,
      table.date,
      table.model,
    ),
    index("anthropic_usage_metrics_user_date_idx").on(table.userId, table.date),
    index("anthropic_usage_metrics_date_idx").on(table.date),
    index("anthropic_usage_metrics_pricing_resolved_idx").on(
      table.pricingResolved,
    ),
  ],
);

// Anthropic Sync Status (per-user sync tracking + cached API key ID)
export const anthropicSyncStatus = pgTable(
  "anthropic_sync_status",
  {
    id: serial("id").primaryKey(),
    // No FK constraint — userId=0 is used as a global lock sentinel row
    userId: integer("user_id").notNull(),
    lastSyncStartedAt: timestamp("last_sync_started_at"),
    lastSyncCompletedAt: timestamp("last_sync_completed_at"),
    lastSyncError: varchar("last_sync_error", { length: 500 }),
    syncedDays: integer("synced_days").notNull().default(0),
    resolvedApiKeyId: varchar("resolved_api_key_id", { length: 100 }),
    resolvedWorkspaceId: varchar("resolved_workspace_id", { length: 100 }),
    workspaceSyncCompletedAt: timestamp("workspace_sync_completed_at"),
  },
  (table) => [
    uniqueIndex("anthropic_sync_status_user_id_idx").on(table.userId),
  ],
);

// Sync Sources (019-invoice-automations)
export const syncSources = pgTable(
  "sync_sources",
  {
    id: serial("id").primaryKey(),
    sourceType: syncSourceTypeEnum("source_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    cronSchedule: varchar("cron_schedule", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sync_sources_source_type_idx").on(table.sourceType)],
);

// Sync Events (019-invoice-automations)
export const syncEvents = pgTable(
  "sync_events",
  {
    id: serial("id").primaryKey(),
    sourceType: syncSourceTypeEnum("source_type").notNull(),
    operationType: syncOperationTypeEnum("operation_type")
      .notNull()
      .default("regular"),
    backfillStartDate: date("backfill_start_date"),
    outcome: syncOutcomeEnum("outcome").notNull().default("in_progress"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    triggeredBy: integer("triggered_by").references(() => users.id),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("sync_events_source_type_idx").on(table.sourceType),
    index("sync_events_outcome_idx").on(table.outcome),
    index("sync_events_started_at_idx").on(table.startedAt),
    index("sync_events_source_started_idx").on(
      table.sourceType,
      table.startedAt,
    ),
  ],
);

// Ingestion Log (023-ingestion-history; discriminated in 034-ingestion-types-distinction)
export const ingestionLog = pgTable(
  "ingestion_log",
  {
    id: serial("id").primaryKey(),

    // ── Discriminator (034) ──
    // `kind` classifies what was ingested; `sourceType` records the origin.
    // Defaulted to "invoice" so the additive migration backfills cleanly.
    kind: ingestionKindEnum("kind").notNull().default("invoice"),
    sourceType: ingestionSourceTypeEnum("source_type"),

    // ── Shared across every kind ──
    outcome: ingestionOutcomeEnum("outcome").notNull(),
    channel: ingestionChannelEnum("channel").notNull(),
    label: varchar("label", { length: 500 }),
    errorMessage: text("error_message"),
    uploadedBy: integer("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),

    // ── Polymorphic drill-through (034) ──
    // Replaces the unsafe cross-type FK that linked_invoice_id had become.
    // Intentionally NOT a DB-level foreign key: entityId may reference
    // invoices, license_requests, etc. depending on `kind`.
    entityType: varchar("entity_type", { length: 40 }),
    entityId: integer("entity_id"),

    // ── Type-specific payload (034) ──
    details: jsonb("details").$type<IngestionDetails>(),

    // ── DEPRECATED (034) ──
    // Retained through the expand/migrate phases; dropped in the contract
    // migration (P4) once all readers consume `details` / entity ref.
    filename: varchar("filename", { length: 500 }),
    vendor: varchar("vendor", { length: 255 }),
    invoiceNumber: varchar("invoice_number", { length: 255 }),
    invoiceDate: date("invoice_date"),
    amountCents: integer("amount_cents"),
    blobPathname: text("blob_pathname"),
    linkedInvoiceId: integer("linked_invoice_id").references(
      () => invoices.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("ingestion_log_outcome_idx").on(table.outcome),
    index("ingestion_log_created_at_idx").on(table.createdAt),
    index("ingestion_log_vendor_idx").on(table.vendor),
    index("ingestion_log_channel_idx").on(table.channel),
    index("ingestion_log_kind_idx").on(table.kind),
  ],
);

// Anthropic Workspaces (workspace metadata from Anthropic Admin API)
export const anthropicWorkspaces = pgTable(
  "anthropic_workspaces",
  {
    id: serial("id").primaryKey(),
    workspaceId: varchar("workspace_id", { length: 100 }),
    name: varchar("name", { length: 200 }).notNull(),
    displayColor: varchar("display_color", { length: 20 }),
    isDefault: boolean("is_default").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    anthropicCreatedAt: timestamp("anthropic_created_at"),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anthropic_workspaces_workspace_id_idx")
      .on(table.workspaceId)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    uniqueIndex("anthropic_workspaces_is_default_idx")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    index("anthropic_workspaces_archived_idx").on(table.isArchived),
  ],
);

// Anthropic Workspace Costs (daily cost per workspace from cost_report API)
export const anthropicWorkspaceCosts = pgTable(
  "anthropic_workspace_costs",
  {
    id: serial("id").primaryKey(),
    workspaceId: varchar("workspace_id", { length: 100 }),
    date: date("date").notNull(),
    costCents: integer("cost_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anthropic_workspace_costs_workspace_date_idx")
      .on(table.workspaceId, table.date)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    uniqueIndex("anthropic_workspace_costs_default_date_idx")
      .on(table.date)
      .where(sql`${table.workspaceId} IS NULL`),
    index("anthropic_workspace_costs_date_idx").on(table.date),
    index("anthropic_workspace_costs_workspace_id_idx").on(table.workspaceId),
    check(
      "anthropic_workspace_costs_cost_cents_check",
      sql`${table.costCents} >= 0`,
    ),
  ],
);

// Anthropic Workspace Limits (admin-configured monthly spending limits)
export const anthropicWorkspaceLimits = pgTable(
  "anthropic_workspace_limits",
  {
    id: serial("id").primaryKey(),
    workspaceId: varchar("workspace_id", { length: 100 }),
    limitCents: integer("limit_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anthropic_workspace_limits_workspace_id_idx")
      .on(table.workspaceId)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    uniqueIndex("anthropic_workspace_limits_default_idx")
      .on(sql`(1)`)
      .where(sql`${table.workspaceId} IS NULL`),
  ],
);

// Anthropic Org Config (singleton row, id always = 1)
export const anthropicOrgConfig = pgTable(
  "anthropic_org_config",
  {
    id: integer("id").primaryKey().default(1),
    billingBudgetLimitCents: integer("billing_budget_limit_cents"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id),
  },
  (table) => [check("anthropic_org_config_id_check", sql`${table.id} = 1`)],
);

// License Requests (032-automation-workflow)
export const licenseRequests = pgTable(
  "license_requests",
  {
    id: serial("id").primaryKey(),
    formResponseId: text("form_response_id").notNull().unique(),
    requesterEmail: text("requester_email").notNull(),
    requesterName: text("requester_name").notNull(),
    requesterUserId: integer("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // 032-v2: role + profile from the Form; the Hub derives the tool via
    // tool_mappings. Null on rows ingested under the v1 tool-name contract.
    requesterRole: userDisciplineEnum("requester_role"),
    requesterProfile: licenseRequestProfileEnum("requester_profile"),
    justification: text("justification"),
    // Nullable since 032-v2: indie requests have no derived tool until an
    // approver picks one ("needs decision").
    requestedToolId: integer("requested_tool_id").references(() => aiTools.id, {
      onDelete: "restrict",
    }),
    requestedTierId: integer("requested_tier_id").references(
      () => accessTiers.id,
      { onDelete: "set null" },
    ),
    formPayload: jsonb("form_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    teamsTeamId: text("teams_team_id").notNull(),
    teamsChannelId: text("teams_channel_id").notNull(),
    teamsParentMessageId: text("teams_parent_message_id").notNull(),
    teamsChatId: text("teams_chat_id").notNull(),
    status: licenseRequestStatusEnum("status")
      .notNull()
      .default("pending_review"),
    decidedBy: integer("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    completedBy: integer("completed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvalMessageMd: text("approval_message_md"),
    completionMessageMd: text("completion_message_md"),
    completedAt: timestamp("completed_at"),
    assignmentId: integer("assignment_id").references(
      () => licenseAssignments.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("license_requests_requester_user_id_idx").on(table.requesterUserId),
    index("license_requests_requested_tool_id_idx").on(table.requestedToolId),
    index("license_requests_status_idx").on(table.status),
    index("license_requests_decided_by_idx").on(table.decidedBy),
    index("license_requests_assignment_id_idx").on(table.assignmentId),
    index("license_requests_created_at_idx").on(table.createdAt),
  ],
);

// Message Templates (032-automation-workflow)
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: serial("id").primaryKey(),
    toolId: integer("tool_id")
      .notNull()
      .references(() => aiTools.id, { onDelete: "cascade" }),
    tierId: integer("tier_id").references(() => accessTiers.id, {
      onDelete: "cascade",
    }),
    kind: messageTemplateKindEnum("kind").notNull(),
    bodyMd: text("body_md").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("message_templates_tool_id_idx").on(table.toolId),
    index("message_templates_tier_id_idx").on(table.tierId),
    // Postgres treats NULL values as distinct in unique indexes by default,
    // which means multiple (toolId, NULL, kind) tool-default rows would not
    // collide. Use a partial index + a NULLS-NOT-DISTINCT variant to enforce
    // "one tool-default per kind" and "one tier-override per (tool, tier, kind)".
    uniqueIndex("message_templates_tool_default_kind_idx")
      .on(table.toolId, table.kind)
      .where(sql`${table.tierId} IS NULL`),
    uniqueIndex("message_templates_tool_tier_kind_idx")
      .on(table.toolId, table.tierId, table.kind)
      .where(sql`${table.tierId} IS NOT NULL`),
  ],
);

// Tool Mappings (032-v2) — how (role, profile) from the request form resolves
// to a proposed tool. Seeded from the AI Tooling Guide, editable in Settings.
// role NULL = applies to any role. toolId NULL = "needs decision" (indie).
export const toolMappings = pgTable(
  "tool_mappings",
  {
    id: serial("id").primaryKey(),
    role: userDisciplineEnum("role"),
    profile: licenseRequestProfileEnum("profile").notNull(),
    toolId: integer("tool_id").references(() => aiTools.id, {
      onDelete: "cascade",
    }),
    defaultTierId: integer("default_tier_id").references(() => accessTiers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("tool_mappings_tool_id_idx").on(table.toolId),
    // Same NULL-distinctness handling as message_templates above: one row per
    // (role, profile) and one any-role row per profile.
    uniqueIndex("tool_mappings_role_profile_idx")
      .on(table.role, table.profile)
      .where(sql`${table.role} IS NOT NULL`),
    uniqueIndex("tool_mappings_any_profile_idx")
      .on(table.profile)
      .where(sql`${table.role} IS NULL`),
  ],
);

// MCP OAuth (038-mcp-v2) — minimal embedded OAuth 2.1 authorization server so
// Claude clients can connect to the MCP endpoint with per-user grants. Tokens
// and authorization codes are stored as SHA-256 hashes only (invite_tokens
// pattern); raw values exist client-side only.
export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    id: serial("id").primaryKey(),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    clientName: varchar("client_name", { length: 255 }).notNull(),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [
    uniqueIndex("mcp_oauth_clients_client_id_idx").on(table.clientId),
  ],
);

export const mcpOauthCodes = pgTable(
  "mcp_oauth_codes",
  {
    id: serial("id").primaryKey(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => mcpOauthClients.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    // PKCE S256 challenge — base64url(sha256(verifier)), always 43 chars but
    // sized generously.
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_codes_code_hash_idx").on(table.codeHash),
    index("mcp_oauth_codes_user_id_idx").on(table.userId),
  ],
);

export const mcpOauthTokens = pgTable(
  "mcp_oauth_tokens",
  {
    id: serial("id").primaryKey(),
    // Refresh-rotation lineage: rotation revokes the old row and inserts a new
    // one with the same familyId. Replaying a revoked refresh token revokes
    // the whole family (RFC 9700 §4.14 reuse detection).
    familyId: varchar("family_id", { length: 36 }).notNull(),
    accessTokenHash: varchar("access_token_hash", { length: 64 }).notNull(),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => mcpOauthClients.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 255 }).notNull(),
    accessExpiresAt: timestamp("access_expires_at").notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_tokens_access_token_hash_idx").on(
      table.accessTokenHash,
    ),
    uniqueIndex("mcp_oauth_tokens_refresh_token_hash_idx").on(
      table.refreshTokenHash,
    ),
    index("mcp_oauth_tokens_user_id_idx").on(table.userId),
    index("mcp_oauth_tokens_family_id_idx").on(table.familyId),
  ],
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  licenseAssignments: many(licenseAssignments),
  assignmentComments: many(assignmentComments),
  changesBy: many(changeHistory),
  invoices: many(invoices),
  githubProfile: one(githubProfiles, {
    fields: [users.id],
    references: [githubProfiles.userId],
  }),
  inviteTokens: many(inviteTokens),
  anthropicUsageMetrics: many(anthropicUsageMetrics),
  anthropicSyncStatus: one(anthropicSyncStatus, {
    fields: [users.id],
    references: [anthropicSyncStatus.userId],
  }),
  budgetExtensionsCreated: many(budgetExtensions),
}));

export const inviteTokensRelations = relations(inviteTokens, ({ one }) => ({
  user: one(users, {
    fields: [inviteTokens.userId],
    references: [users.id],
  }),
}));

export const aiToolsRelations = relations(aiTools, ({ many }) => ({
  accessTiers: many(accessTiers),
  licenseAssignments: many(licenseAssignments),
  budgetExtensions: many(budgetExtensions),
}));

export const accessTiersRelations = relations(accessTiers, ({ one, many }) => ({
  tool: one(aiTools, {
    fields: [accessTiers.toolId],
    references: [aiTools.id],
  }),
  licenseAssignments: many(licenseAssignments),
}));

export const licenseAssignmentsRelations = relations(
  licenseAssignments,
  ({ one, many }) => ({
    user: one(users, {
      fields: [licenseAssignments.userId],
      references: [users.id],
    }),
    tool: one(aiTools, {
      fields: [licenseAssignments.toolId],
      references: [aiTools.id],
    }),
    tier: one(accessTiers, {
      fields: [licenseAssignments.tierId],
      references: [accessTiers.id],
    }),
    comments: many(assignmentComments),
  }),
);

export const annualBudgetsRelations = relations(annualBudgets, ({ many }) => ({
  periods: many(budgetPeriods),
  extensions: many(budgetExtensions),
}));

export const budgetPeriodsRelations = relations(
  budgetPeriods,
  ({ one, many }) => ({
    budget: one(annualBudgets, {
      fields: [budgetPeriods.budgetId],
      references: [annualBudgets.id],
    }),
    billedCosts: many(billedCosts),
    extensionAllocations: many(budgetExtensionPeriodAllocations),
  }),
);

export const budgetExtensionsRelations = relations(
  budgetExtensions,
  ({ one, many }) => ({
    budget: one(annualBudgets, {
      fields: [budgetExtensions.budgetId],
      references: [annualBudgets.id],
    }),
    linkedTool: one(aiTools, {
      fields: [budgetExtensions.linkedToolId],
      references: [aiTools.id],
    }),
    creator: one(users, {
      fields: [budgetExtensions.createdBy],
      references: [users.id],
    }),
    allocations: many(budgetExtensionPeriodAllocations),
  }),
);

export const budgetExtensionPeriodAllocationsRelations = relations(
  budgetExtensionPeriodAllocations,
  ({ one }) => ({
    extension: one(budgetExtensions, {
      fields: [budgetExtensionPeriodAllocations.extensionId],
      references: [budgetExtensions.id],
    }),
    period: one(budgetPeriods, {
      fields: [budgetExtensionPeriodAllocations.periodId],
      references: [budgetPeriods.id],
    }),
  }),
);

export const assignmentCommentsRelations = relations(
  assignmentComments,
  ({ one }) => ({
    assignment: one(licenseAssignments, {
      fields: [assignmentComments.assignmentId],
      references: [licenseAssignments.id],
    }),
    author: one(users, {
      fields: [assignmentComments.authorId],
      references: [users.id],
    }),
  }),
);

export const billedCostsRelations = relations(billedCosts, ({ one, many }) => ({
  period: one(budgetPeriods, {
    fields: [billedCosts.periodId],
    references: [budgetPeriods.id],
  }),
  invoices: many(invoices),
}));

export const changeHistoryRelations = relations(changeHistory, ({ one }) => ({
  changedByUser: one(users, {
    fields: [changeHistory.changedBy],
    references: [users.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  uploader: one(users, {
    fields: [invoices.uploadedBy],
    references: [users.id],
  }),
  linkedBilledCost: one(billedCosts, {
    fields: [invoices.linkedBilledCostId],
    references: [billedCosts.id],
  }),
}));

export const githubConnectionsRelations = relations(
  githubConnections,
  ({ one, many }) => ({
    connectedByUser: one(users, {
      fields: [githubConnections.connectedBy],
      references: [users.id],
    }),
    syncEvents: many(githubSyncEvents),
    copilotUsageMetrics: many(copilotUsageMetrics),
    copilotBillingSnapshots: many(copilotBillingSnapshots),
  }),
);

export const githubProfilesRelations = relations(githubProfiles, ({ one }) => ({
  user: one(users, {
    fields: [githubProfiles.userId],
    references: [users.id],
  }),
}));

export const githubSyncEventsRelations = relations(
  githubSyncEvents,
  ({ one }) => ({
    connection: one(githubConnections, {
      fields: [githubSyncEvents.connectionId],
      references: [githubConnections.id],
    }),
    triggeredByUser: one(users, {
      fields: [githubSyncEvents.triggeredBy],
      references: [users.id],
    }),
  }),
);

export const copilotUsageMetricsRelations = relations(
  copilotUsageMetrics,
  ({ one }) => ({
    connection: one(githubConnections, {
      fields: [copilotUsageMetrics.connectionId],
      references: [githubConnections.id],
    }),
  }),
);

export const copilotBillingSnapshotsRelations = relations(
  copilotBillingSnapshots,
  ({ one }) => ({
    connection: one(githubConnections, {
      fields: [copilotBillingSnapshots.connectionId],
      references: [githubConnections.id],
    }),
  }),
);

export const anthropicUsageMetricsRelations = relations(
  anthropicUsageMetrics,
  ({ one }) => ({
    user: one(users, {
      fields: [anthropicUsageMetrics.userId],
      references: [users.id],
    }),
  }),
);

export const anthropicSyncStatusRelations = relations(
  anthropicSyncStatus,
  ({ one }) => ({
    user: one(users, {
      fields: [anthropicSyncStatus.userId],
      references: [users.id],
    }),
  }),
);

export const syncEventsRelations = relations(syncEvents, ({ one }) => ({
  triggeredByUser: one(users, {
    fields: [syncEvents.triggeredBy],
    references: [users.id],
  }),
}));

export const ingestionLogRelations = relations(ingestionLog, ({ one }) => ({
  linkedInvoice: one(invoices, {
    fields: [ingestionLog.linkedInvoiceId],
    references: [invoices.id],
  }),
  uploader: one(users, {
    fields: [ingestionLog.uploadedBy],
    references: [users.id],
  }),
}));

// Ingestion Filters (024-ingestion-filter)
export const ingestionFilters = pgTable(
  "ingestion_filters",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    field: filterFieldEnum("field").notNull(),
    mode: filterModeEnum("mode").notNull(),
    value: jsonb("value").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("ingestion_filters_enabled_idx").on(table.enabled)],
);

export const ingestionFiltersRelations = relations(
  ingestionFilters,
  ({ one }) => ({
    creator: one(users, {
      fields: [ingestionFilters.createdBy],
      references: [users.id],
    }),
  }),
);

// License Requests / Message Templates relations (032-automation-workflow)
export const licenseRequestsRelations = relations(
  licenseRequests,
  ({ one }) => ({
    requesterUser: one(users, {
      fields: [licenseRequests.requesterUserId],
      references: [users.id],
      relationName: "license_request_requester",
    }),
    requestedTool: one(aiTools, {
      fields: [licenseRequests.requestedToolId],
      references: [aiTools.id],
    }),
    requestedTier: one(accessTiers, {
      fields: [licenseRequests.requestedTierId],
      references: [accessTiers.id],
    }),
    decidedByUser: one(users, {
      fields: [licenseRequests.decidedBy],
      references: [users.id],
      relationName: "license_request_decided_by",
    }),
    completedByUser: one(users, {
      fields: [licenseRequests.completedBy],
      references: [users.id],
      relationName: "license_request_completed_by",
    }),
    assignment: one(licenseAssignments, {
      fields: [licenseRequests.assignmentId],
      references: [licenseAssignments.id],
    }),
  }),
);

export const messageTemplatesRelations = relations(
  messageTemplates,
  ({ one }) => ({
    tool: one(aiTools, {
      fields: [messageTemplates.toolId],
      references: [aiTools.id],
    }),
    tier: one(accessTiers, {
      fields: [messageTemplates.tierId],
      references: [accessTiers.id],
    }),
  }),
);

export const toolMappingsRelations = relations(toolMappings, ({ one }) => ({
  tool: one(aiTools, {
    fields: [toolMappings.toolId],
    references: [aiTools.id],
  }),
  defaultTier: one(accessTiers, {
    fields: [toolMappings.defaultTierId],
    references: [accessTiers.id],
  }),
}));

// Forecast Scenarios (041-forecast-scenario-persistence)
// Named, shared what-if parameter sets for the Budget / Cost Forecast
// Simulation. Stores assumptions (ForecastInputs), never computed results —
// scenarios are re-projected against live data on load.
export const forecastScenarios = pgTable(
  "forecast_scenarios",
  {
    id: serial("id").primaryKey(),
    budgetId: integer("budget_id")
      .notNull()
      .references(() => annualBudgets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    params: jsonb("params").$type<ForecastInputs>().notNull(),
    // Attribution only — deleting a user must not destroy shared scenarios.
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("forecast_scenarios_budget_id_idx").on(table.budgetId),
    index("forecast_scenarios_created_by_idx").on(table.createdBy),
    // One name per budget, case-insensitive ("Plan B" ≡ "plan b"). This index
    // is the single source of duplicate-name rejection — create/update map
    // its violation (23505) to a friendly ActionResult error, race-free.
    uniqueIndex("forecast_scenarios_budget_name_idx").on(
      table.budgetId,
      sql`lower(${table.name})`,
    ),
  ],
);

export const forecastScenariosRelations = relations(
  forecastScenarios,
  ({ one }) => ({
    budget: one(annualBudgets, {
      fields: [forecastScenarios.budgetId],
      references: [annualBudgets.id],
    }),
    creator: one(users, {
      fields: [forecastScenarios.createdBy],
      references: [users.id],
    }),
  }),
);
