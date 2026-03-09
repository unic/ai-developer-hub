# Research: GitHub Copilot Integration

**Feature**: 013-github-copilot-integration
**Date**: 2026-03-09

## Decision 1: GitHub Copilot API Strategy

**Decision**: Use the Copilot Metrics API (GA) for org-level usage aggregates, and the Copilot Billing/Seats API for seat management and billing data. Plan for future migration to the Copilot Usage Metrics API when it reaches GA.

**Rationale**: Three generations of Copilot metrics APIs exist:

| API | Status | Data Window | Granularity |
|-----|--------|-------------|-------------|
| Copilot Usage (`/copilot/usage`) | Deprecated (retired Feb 2025) | Was 28 days | Org-level |
| Copilot Metrics (`/copilot/metrics`) | GA, closing April 2, 2026 | 28 days rolling | Org/team, daily aggregates |
| Copilot Usage Metrics (`/copilot/usage-metrics`) | Public Preview | Up to 1 year | Per-user daily |

The Metrics API provides the richest org-level data (suggestions, acceptances, lines, language/editor breakdowns) and is currently GA. The Billing/Seats API (`/copilot/billing`, `/copilot/billing/seats`) is stable and provides seat-level data.

**Important**: The Metrics API only provides **28 days** of rolling data (not 100 days as initially assumed). This makes the local persistence requirement even more critical — without daily syncing, data is permanently lost after 28 days.

**Alternatives considered**:
- New Usage Metrics API: Per-user granularity and 1-year retention, but still public preview and requires enterprise-level policy enablement. Noted as future enhancement.
- Legacy Usage API: Deprecated and retired.

## Decision 2: Authentication Scopes

**Decision**: Require `manage_billing:copilot` scope (covers billing + seats) AND `read:org` scope (covers metrics). The existing GitHub connection already requires `read:org` + `read:user`, so only `manage_billing:copilot` needs to be added.

**Rationale**:

| Endpoint Category | Required Scope |
|---|---|
| Billing/Seats (`/copilot/billing/*`) | `manage_billing:copilot` |
| Metrics (`/copilot/metrics`) | `read:org` (already required) |

**Alternatives considered**:
- `admin:org` scope: Too broad, grants write access to org settings.
- Fine-grained PAT: More restrictive but not all users have access to create them.

## Decision 3: Sync Architecture

**Decision**: Copilot sync is an automated background process (not preview/confirm like member sync). Uses the same `githubSyncEvents` tracking with a new sync type discriminator. Sync is triggered via a Next.js API route that can be called by a cron service or manually.

**Rationale**: Unlike member sync (which may import new users and needs human review), Copilot sync is purely data ingestion — it creates/updates read-only records. No human review step is needed. The sync atomically processes three data categories in sequence: (1) billing/org settings, (2) seats, (3) usage metrics.

**Alternatives considered**:
- Preview/confirm pattern (like member sync): Unnecessary overhead for read-only data ingestion.
- Separate sync per data type: Adds complexity; a single sync covering all three is simpler and ensures data consistency.

## Decision 4: Data Retention & Metrics Window

**Decision**: Sync daily to capture the full 28-day rolling window. Store all metrics permanently. Each daily sync captures the latest available day's data. The system deduplicates by (connectionId + date) to handle re-syncs gracefully.

**Rationale**: The Metrics API provides a 28-day rolling window loaded end-of-day UTC. Data older than 28 days is permanently unavailable from the API. Daily syncing ensures no data gaps. On initial sync, the system pulls all 28 available days.

**Alternatives considered**:
- Weekly sync: Risk of losing days if API window shifts. Daily is safer.
- Sync full 28-day window every time: Wastes API calls. Better to sync only new days (check latest stored date, fetch since then).

## Decision 5: Schema Extension Strategy

**Decision**: Extend existing tables minimally (2 new columns) and create 2 new tables. No modifications to existing table structure beyond additive columns.

**Changes to existing tables**:
- `githubConnections`: Add `copilotSyncEnabled` (boolean, default false) and `copilotSyncSchedule` (varchar, default "daily")
- `licenseAssignments`: Add `source` (varchar, default "manual") to distinguish sync-managed records
- `githubSyncEvents`: Add `syncType` (enum: "members" | "copilot") to distinguish sync types

**New tables**:
- `copilotUsageMetrics`: Daily aggregated org-level usage data
- `copilotBillingSnapshots`: Monthly billing snapshots

**Alternatives considered**:
- Separate Copilot connection table: Unnecessary duplication — same org, same token.
- Store metrics as JSONB: Loses queryability for aggregations and filtering.

## Decision 6: Seat-to-Assignment Mapping

**Decision**: Match Copilot seats to application users via the existing `githubProfiles.githubId` field. Create license assignments only for matched users. Unmatched seats are tracked in the `copilotUsageMetrics` aggregate counts and visible in the Copilot seats table via a dedicated column in the seat data.

**Rationale**: The `githubProfiles` table already maps GitHub users to application users. Copilot seat data includes `assignee.id` (GitHub user ID) which can be joined to `githubProfiles.githubId`. Only matched users get license assignments; unmatched users are shown in the Copilot UI with a prompt to import.

**Alternatives considered**:
- Match by username only: Fragile — GitHub usernames can change.
- Create application users for all seat holders: Too aggressive; admin should decide via existing import flow.

## Decision 7: Billing Data Derivation

**Decision**: Use the `/copilot/billing` endpoint for seat counts and plan type, then calculate billing amounts from (seat count × plan price). Store snapshots monthly. Create `billedCosts` entries only when matching budget periods exist.

**Rationale**: GitHub does not provide a dedicated Copilot billing amount API. The billing endpoint returns seat breakdown and plan type. Monthly cost is derived: `totalSeats × monthlyCostPerSeat`. Plan pricing is well-known: Business = $19/seat/month, Enterprise = $39/seat/month. These are stored as access tier costs and can be updated if pricing changes.

**Alternatives considered**:
- Wait for invoice upload: Requires manual step; automated derivation is more reliable.
- Use GitHub billing API (general): May include non-Copilot charges; too broad.

## Decision 8: Tab Bar Implementation

**Decision**: Create a Copilot layout at `/copilot/layout.tsx` with a tab bar component matching the Reports page pattern. Tabs: Overview (default), Seats, Billing, Analytics. Seat detail (`/copilot/seats/[userId]`) renders within the Seats tab context.

**Rationale**: The Reports page already establishes this pattern with `reports-tab-bar.tsx` using URL-based tab state. Consistent navigation reduces cognitive load.

## Decision 9: Mutual Exclusion for Syncs

**Decision**: Use a database-level lock via the `githubSyncEvents` table — check for any `"in_progress"` sync event before starting a new one. If one exists, reject with "Sync already in progress."

**Rationale**: Simple, reliable, and database-consistent. No need for Redis or file locks. The sync event table already tracks in-progress status.

**Alternatives considered**:
- In-memory lock: Lost on server restart; doesn't work with multiple instances.
- Redis lock: Adds infrastructure dependency for a simple use case.

## API Endpoint Reference

### Billing & Seats

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/orgs/{org}/copilot/billing` | GET | Org Copilot settings, seat breakdown, plan type |
| `/orgs/{org}/copilot/billing/seats` | GET | Paginated list of seat assignments (100/page max) |

**Key seat fields**: `assignee.login`, `assignee.id`, `created_at`, `last_activity_at`, `last_activity_editor`, `plan_type`, `pending_cancellation_date`

### Metrics

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/orgs/{org}/copilot/metrics` | GET | Array of daily metric objects (28 days max) |

**Key metric fields per day**: `date`, `total_active_users`, `total_engaged_users`, `copilot_ide_code_completions` (nested: editors → models → languages → `total_code_suggestions`, `total_code_acceptances`, `total_code_lines_suggested`, `total_code_lines_accepted`), `copilot_ide_chat`, `copilot_dotcom_chat`, `copilot_dotcom_pull_requests`

### Rate Limits

- PAT: 5,000 requests/hour
- Secondary: 100 concurrent, 900 points/minute
- Headers: `x-ratelimit-remaining`, `x-ratelimit-reset`
- Pagination: `Link` header with `rel="next"`, `per_page` max 100 (seats) or 28 (metrics)
