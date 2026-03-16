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
} from "drizzle-orm/pg-core";
import type { UserPreferences } from "@/types";
import { relations } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "viewer"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const toolStatusEnum = pgEnum("tool_status", ["active", "archived"]);
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "active",
  "inactive",
]);
export const budgetStatusEnum = pgEnum("budget_status", [
  "active",
  "archived",
]);
export const periodTypeEnum = pgEnum("period_type", ["monthly", "quarterly"]);
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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_circle_idx").on(table.circle),
    index("users_status_idx").on(table.status),
  ]
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_tools_name_idx").on(table.name),
    index("ai_tools_vendor_idx").on(table.vendor),
  ]
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
  ]
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
      table.status
    ),
  ]
);

// Annual Budgets
export const annualBudgets = pgTable(
  "annual_budgets",
  {
    id: serial("id").primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    totalAmountCents: integer("total_amount_cents").notNull(),
    periodType: periodTypeEnum("period_type").notNull(),
    status: budgetStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("annual_budgets_fiscal_year_idx").on(table.fiscalYear),
    index("annual_budgets_status_idx").on(table.status),
  ]
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
      table.periodIndex
    ),
  ]
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
  ]
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
  ]
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
    vendorReference: varchar("vendor_reference", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("billed_costs_period_id_idx").on(table.periodId),
    index("billed_costs_invoice_date_idx").on(table.invoiceDate),
  ]
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
      { onDelete: "set null" }
    ),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
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
  ]
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
    copilotSyncEnabled: boolean("copilot_sync_enabled").notNull().default(false),
    copilotSyncSchedule: varchar("copilot_sync_schedule", { length: 50 })
      .notNull()
      .default("daily"),
  },
  (table) => [index("github_connections_status_idx").on(table.status)]
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
  ]
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
    errorMessage: text("error_message"),
    syncType: copilotSyncTypeEnum("sync_type").notNull().default("members"),
    seatsProcessed: integer("seats_processed"),
    metricsProcessed: integer("metrics_processed"),
    billingProcessed: integer("billing_processed"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("github_sync_events_connection_id_idx").on(table.connectionId),
    index("github_sync_events_triggered_by_idx").on(table.triggeredBy),
  ]
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
    totalDotcomChatTurns: integer("total_dotcom_chat_turns"),
    totalPrSummaries: integer("total_pr_summaries"),
    languageBreakdown: jsonb("language_breakdown"),
    editorBreakdown: jsonb("editor_breakdown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("copilot_usage_metrics_connection_date_idx").on(
      table.connectionId,
      table.date
    ),
    index("copilot_usage_metrics_date_idx").on(table.date),
  ]
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
      table.billingMonth
    ),
  ]
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
      table.model
    ),
    index("anthropic_usage_metrics_user_date_idx").on(table.userId, table.date),
    index("anthropic_usage_metrics_date_idx").on(table.date),
  ]
);

// Anthropic Sync Status (per-user sync tracking + cached API key ID)
export const anthropicSyncStatus = pgTable(
  "anthropic_sync_status",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastSyncStartedAt: timestamp("last_sync_started_at"),
    lastSyncCompletedAt: timestamp("last_sync_completed_at"),
    lastSyncError: varchar("last_sync_error", { length: 500 }),
    syncedDays: integer("synced_days").notNull().default(0),
    resolvedApiKeyId: varchar("resolved_api_key_id", { length: 100 }),
  },
  (table) => [uniqueIndex("anthropic_sync_status_user_id_idx").on(table.userId)]
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
  anthropicUsageMetrics: many(anthropicUsageMetrics),
  anthropicSyncStatus: one(anthropicSyncStatus, {
    fields: [users.id],
    references: [anthropicSyncStatus.userId],
  }),
}));

export const aiToolsRelations = relations(aiTools, ({ many }) => ({
  accessTiers: many(accessTiers),
  licenseAssignments: many(licenseAssignments),
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
  })
);

export const annualBudgetsRelations = relations(annualBudgets, ({ many }) => ({
  periods: many(budgetPeriods),
}));

export const budgetPeriodsRelations = relations(budgetPeriods, ({ one, many }) => ({
  budget: one(annualBudgets, {
    fields: [budgetPeriods.budgetId],
    references: [annualBudgets.id],
  }),
  billedCosts: many(billedCosts),
}));

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
  })
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
  })
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
  })
);

export const copilotUsageMetricsRelations = relations(
  copilotUsageMetrics,
  ({ one }) => ({
    connection: one(githubConnections, {
      fields: [copilotUsageMetrics.connectionId],
      references: [githubConnections.id],
    }),
  })
);

export const copilotBillingSnapshotsRelations = relations(
  copilotBillingSnapshots,
  ({ one }) => ({
    connection: one(githubConnections, {
      fields: [copilotBillingSnapshots.connectionId],
      references: [githubConnections.id],
    }),
  })
);

export const anthropicUsageMetricsRelations = relations(
  anthropicUsageMetrics,
  ({ one }) => ({
    user: one(users, {
      fields: [anthropicUsageMetrics.userId],
      references: [users.id],
    }),
  })
);

export const anthropicSyncStatusRelations = relations(
  anthropicSyncStatus,
  ({ one }) => ({
    user: one(users, {
      fields: [anthropicSyncStatus.userId],
      references: [users.id],
    }),
  })
);
