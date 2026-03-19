# Research: 015-github-member-sync

**Date**: 2026-03-10

## R1: Match Suggestion Algorithm

**Decision**: Use `string-similarity` (npm) for Dice coefficient scoring on names; use domain extraction for email similarity.

**Rationale**: Lightweight (~2KB), zero dependencies, provides `compareTwoStrings()` returning 0–1 score. Already proven pattern in similar tools. Dice coefficient handles name transpositions well (e.g., "John Doe" vs "Doe, John"). No need for heavier libraries like fuse.js since we only compare two fields (name, email domain) and show top 3.

**Alternatives considered**:
- `fuse.js`: Overkill for pairwise comparison; designed for search-in-list, not 1:1 scoring
- Custom Levenshtein: More code to maintain, Dice coefficient better for name matching
- Server-side matching: Unnecessary network round-trip; client already has both lists in memory from sync preview

## R2: Searchable User Combobox Pattern

**Decision**: Use existing `Command` + `Popover` shadcn/ui components (cmdk v1.1.1 already installed) to build a user search combobox.

**Rationale**: The `DataTableFacetedFilter` component already proves this pattern works in the codebase. Command provides built-in keyboard navigation, search filtering, and empty state handling. No new dependencies needed.

**Alternatives considered**:
- TanStack Table inline search: Doesn't support selecting a single user from results
- Custom autocomplete: Reinvents what cmdk already provides
- Radix Select with search: Less flexible than Command for free-text search

## R3: Inline User Creation Form

**Decision**: Use a collapsible inline form within the unmatched member row, pre-filled from GitHub data. Reuse existing `userSchema` validation with relaxed password requirement (auto-generate temp password).

**Rationale**: Existing `confirmGitHubSync` already creates users with temp password "changeme123" for imported members. Same pattern for inline creation. Required fields: name (pre-filled from `githubName || githubLogin`), email (pre-filled from `githubEmail` if available), role defaults to "viewer".

**Alternatives considered**:
- Modal dialog: Adds visual noise when resolving many members
- Navigate to /users/new: Breaks the sync flow (violates FR-006b)
- Bulk form at bottom: Loses context of which GitHub member maps to which form

## R4: Schema Change for Manual Match Tracking

**Decision**: Add `manuallyMatchedCount` integer column (nullable) to `githubSyncEvents` table. Add `createdCount` integer column (nullable) for inline-created users.

**Rationale**: FR-011 requires separately tracking manually matched vs auto-matched. A dedicated column is cleaner than deriving from changeHistory queries. The existing `importedCount` covers the old "import unmatched as new user" flow but doesn't distinguish between auto-imported and manually created.

**Alternatives considered**:
- Derive from changeHistory: Requires join query, slower for dashboard display
- Reuse importedCount: Loses distinction between auto-import and manual creation
- No schema change: Can't fulfill FR-011 measurable tracking requirement

## R5: Pending Match State Management

**Decision**: Client-side React state using a `Map<string, PendingResolution>` keyed by `githubLogin`. No server persistence until sync confirmation.

**Rationale**: Pending matches are transient — discarded if admin cancels (edge case in spec). Keeping state client-side avoids unnecessary server round-trips and database writes for uncommitted decisions. The map structure supports O(1) lookup for undo operations (FR-008).

**Alternatives considered**:
- Server-side session storage: Adds complexity for a transient state
- URL search params: Too limited for complex resolution data
- React context: Overkill since state is local to one component tree

## R6: Confirm Sync API Extension

**Decision**: Extend `confirmGitHubSync` action to accept `manualMatches: Array<{ githubLogin: string, userId: number }>` and `newUsers: Array<{ githubLogin: string, name: string, email: string }>` in addition to existing `importGitHubLogins`.

**Rationale**: Clean separation of the three resolution types. Server re-validates all matches against current database state before committing (consistent with existing re-fetch pattern in `confirmGitHubSync`).

**Alternatives considered**:
- Single `resolutions` array with discriminated union: More complex type but less clear API surface
- Separate server actions per resolution type: Breaks atomicity of the sync confirmation
- Keep existing API, add manual matches as separate call: Race condition risk between calls
