# Research: Enhance Core Features

**Feature Branch**: `003-enhance-core-features`
**Date**: 2026-03-03

## R1: Database Column Rename (Department → Circle)

**Decision**: Single-step `ALTER TABLE RENAME COLUMN` + `ALTER INDEX RENAME TO` via manual migration SQL.

**Rationale**: PostgreSQL `RENAME COLUMN` is a metadata-only catalog operation that completes in milliseconds regardless of row count. Neon serverless has no long-running connections to block. The column has no foreign keys pointing to it, making a single-step rename safe.

**Alternatives considered**:
- **Staged migration (add new column → copy → drop old)**: Unnecessary complexity for a catalog-only rename. Would be needed only for high-traffic production systems with persistent connections.
- **drizzle-kit interactive rename detection**: drizzle-kit 0.31.x can detect renames interactively, but CI/automated flows cannot answer the prompt. Manual migration SQL is more reliable.
- **drizzle-kit push**: Unsuitable for production Neon — may generate drop/add instead of rename.

**Implementation details**:
- Write manual migration: `ALTER TABLE "users" RENAME COLUMN "department" TO "circle";` + `ALTER INDEX "users_department_idx" RENAME TO "users_circle_idx";`
- Update `schema.ts` property name and column argument from `department` to `circle`
- Update all references: `validators.ts`, `actions/users.ts`, `seed.ts`, user forms, users table, reports page, CSV import
- CSV import: accept both `circle` (new) and `department` (legacy) headers, mapping both to the `circle` field
- Run `drizzle-kit generate` after to sync snapshot metadata

---

## R2: Unauthenticated Sidebar & Role-Based Navigation

**Decision**: Remove middleware redirects; use per-page `AuthGuard` server component; always render sidebar in root layout with nullable user props.

**Rationale**: NextAuth v5's default middleware behavior redirects unauthenticated requests to `/login`, which prevents showing the sidebar with a login button. Moving to per-page auth guards gives fine-grained control: show "authentication required" in the content area while keeping the sidebar visible.

**Alternatives considered**:
- **`authorized` callback in auth.ts**: Runs in Edge Runtime, returns boolean causing redirect. Cannot show custom "auth required" content. Rejected.
- **Keep middleware redirect + special-case root**: Would still hide the sidebar from unauthenticated users on all other routes. Rejected.
- **Route groups `(main)` / `(auth)`**: Moving sidebar shell to a `(main)/layout.tsx` route group would cleanly separate sidebar-wrapped pages from login. Considered as an optional refinement but not strictly necessary — the simpler approach of always rendering the sidebar in root layout works because the `(auth)/login/page.tsx` already has its own layout.

**Implementation details**:
- **Middleware**: Replace `export { auth as middleware }` with `export default auth((req) => { res.headers.set("x-pathname", req.nextUrl.pathname); return NextResponse.next(); })`. No redirects.
- **Root layout**: Always render `SidebarProvider` + `AppSidebar` with `userName: string | null` and `userRole: string | null` props.
- **AppSidebar**: When unauthenticated — show branding + "Sign in to access" message + login button in footer. When authenticated — filter nav items by role (`ALL_NAV_ITEMS.filter(item => item.roles.includes(userRole))`).
- **AuthGuard component**: New server component wrapping protected page content. Reads `x-pathname` header for callbackUrl encoding. Shows "Authentication Required" card for unauthenticated, "Access Denied" for wrong role.
- **Login page**: Extract client form to `login-form.tsx`. Read `searchParams.callbackUrl`. Redirect to callbackUrl after sign-in instead of hardcoded `/`.
- **Viewer dashboard**: Personalized summary (own tools count, own license cost, own recent activity) vs admin system-wide metrics.

---

## R3: Editable License Assignments with Retrospective Dating

**Decision**: In-place mutation pattern with `changeHistory` field-level diffing. Separate `assignmentComments` table. AES-256-GCM encryption for API keys via Node.js built-in `crypto`.

**Rationale**: In-place edit (vs. create-new/revoke-old) is required because comments need a stable `assignmentId` foreign key, and workspace/apiKey fields belong to a single canonical record. The existing `changeHistory` table already supports field-level audit trails with `entityType`, `entityId`, `fieldName`, `previousValue`, `newValue`.

**Alternatives considered**:
- **Soft-replace pattern (existing tier upgrade flow)**: Creates new assignment, deactivates old. Loses stable ID for comments and meta fields. Would orphan comments on tier changes. Rejected for edit flow (kept for initial assignment creation).
- **JSONB array for comments**: No atomic append, no per-row constraints, no individual timestamp indexing. Rejected.
- **Plaintext API key storage**: Credential leak risk on database compromise. Node.js built-in `crypto` provides AES-256-GCM with no extra dependencies. Rejected plaintext.
- **Separate encryption library**: `crypto` is built into Node.js. No need for bcrypt (password hashing, not encryption) or external packages.

**Implementation details**:
- **Meta fields on `licenseAssignments`**: Add `workspace varchar(200)` and `apiKeyEncrypted varchar(700)` columns.
- **`assignmentComments` table**: `id`, `assignmentId` (FK cascade), `authorId` (FK restrict), `body varchar(2000)`, `createdAt`, `updatedAt`. Indexed on `assignmentId`, `authorId`, `createdAt`.
- **Encryption**: New `src/lib/crypto.ts` with `encryptApiKey()`, `decryptApiKey()`, `maskApiKey()`. Uses AES-256-GCM with scrypt key derivation from `API_KEY_ENCRYPTION_SECRET` env var.
- **API key reveal**: Server Action `revealApiKey()` re-checks `requireAdmin()` on every call. Client shows masked value by default; reveal fetches plaintext on demand.
- **Retrospective dating**: Zod schema validates date is not in the future. Server action validates date is not before user or tool `createdAt`. Warning (non-blocking) via `warning` field in `ActionResult` when date > 12 months past.
- **Date picker**: Existing `Calendar` component with `captionLayout="dropdown"` for year/month navigation, `disabled` for future dates.
- **`ActionResult` extension**: Add optional `warning?: string` to success branch.

---

## R4: Budget Billed Costs Tracking

**Decision**: New `billedCosts` table with direct FK to `budgetPeriods.id`. Action-level archive guard. Variance = billed − expected.

**Rationale**: Direct FK is explicit, referentially enforced, and avoids date-matching ambiguity at period boundaries. Action-level guards are consistent with the existing `requireAdmin()` pattern and avoid putting DB access in Edge Runtime middleware.

**Alternatives considered**:
- **FK to `annualBudgets` + date matching**: Requires overlap query at every write to resolve which period. Ambiguity at boundaries. Rejected.
- **Middleware-level archive guard**: Next.js middleware runs in Edge Runtime without access to `@neondatabase/serverless`. Would require a separate fetch, adding latency. Rejected.
- **Embedded billed total on `budgetPeriods`**: Would require recalculating on every entry change. Separate table is normalized and allows individual entry CRUD + history. Rejected.

**Implementation details**:
- **`billedCosts` table**: `id`, `periodId` (FK cascade), `amountCents` (integer, positive), `invoiceDate` (date, required), `description` (varchar 500, required), `vendorReference` (varchar 255, optional), `createdAt`, `updatedAt`. Indexed on `periodId` and `invoiceDate`.
- **Terminology rename**: All UI references of "actual costs" → "expected costs". "Expected costs" = calculated from active assignments. "Billed costs" = sum of manual entries.
- **Budget period summary**: Three cost dimensions — planned (manually set), expected (calculated from assignments), billed (sum of entries). Variance = billed − expected.
- **Variance display**: Positive (over-billed) = `text-destructive` with `+` prefix. Negative (under-billed) = `text-muted-foreground`. Uses `+/-` prefix for accessibility (not color-only).
- **Archive guard**: `requireActivePeriod(periodId)` helper checks `period.budget.status === "archived"`. Applied in all billed cost mutation actions.
- **History**: Record creation, update, and deletion in `changeHistory` with `entityType: "billed_cost"`. Deletion records `previousValue` as JSON snapshot before deleting.
- **Zod schemas**: `billedCostSchema` (create), `updateBilledCostSchema` (partial update), `deleteBilledCostSchema` (id only). `invoiceDate` as `z.string().regex(/YYYY-MM-DD/)` to match Drizzle `date` column wire format.

---

## R5: Tier Editing with Change History

**Decision**: Use existing `updateTier` server action pattern. Enhance tier edit UI with inline dialog on tool detail page.

**Rationale**: The `updateTier` action and Zod `updateTierSchema` already exist in the codebase. The action already records changes in `changeHistory`. The missing piece is the UI — tiers are currently displayed as read-only cards. An edit dialog (matching the existing create-tier dialog pattern) completes the feature.

**Alternatives considered**:
- **Inline editing on tier cards**: More complex interaction pattern with save/cancel states. Dialog is simpler and consistent with other edit flows. Rejected.

**Implementation details**:
- **UI**: Add edit button to each tier card on tool detail page. Opens dialog pre-populated with current values. Uses `react-hook-form` + `updateTierSchema`.
- **Deactivation guard**: Existing `updateTier` action already prevents deactivation when active assignments exist. UI should surface the error message clearly.
- **Cost change + assignments**: Existing `costAtAssignmentCents` snapshot semantics are preserved — no retroactive changes to existing assignments. This is already enforced by the data model.

---

## R6: Viewer Role Dashboard & Assignments

**Decision**: Conditional rendering in Dashboard page based on `session.user.role`. Filtered Assignments query for viewers.

**Rationale**: The simplest approach — no new pages or layouts. The Dashboard server component checks the role and renders either admin metrics or viewer-personalized metrics. The Assignments page adds a `where` clause filtering by `userId` for viewers.

**Implementation details**:
- **Viewer Dashboard**: Own assigned tools count, own total license cost, own recent assignment activity (last 5 changes).
- **Viewer Assignments**: `where: eq(licenseAssignments.userId, session.user.id)` filter. Same table UI, just fewer rows.
- **Restricted pages**: Viewer navigating to `/users`, `/tools`, `/budget`, `/reports` sees `AuthGuard` "Access Denied" message.
