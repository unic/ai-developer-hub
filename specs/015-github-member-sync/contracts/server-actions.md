# Server Action Contracts: 015-github-member-sync

**Date**: 2026-03-10

## Modified Action: `confirmGitHubSync`

**File**: `src/actions/github-sync.ts`

### Current Signature

```
confirmGitHubSync(input: { importGitHubLogins: string[] })
  → ActionResult<{ enriched: number; imported: number; skipped: number }>
```

### New Signature

```
confirmGitHubSync(input: {
  importGitHubLogins: string[]                                    // legacy: bulk import selected unmatched
  manualMatches?: Array<{ githubLogin: string; userId: number }>  // NEW: match to existing user
  newUsers?: Array<{ githubLogin: string; name: string; email: string }>  // NEW: create user inline
})
  → ActionResult<{
    enriched: number
    imported: number
    manuallyMatched: number    // NEW
    created: number            // NEW
    skipped: number
  }>
```

### Behavior Changes

1. **manualMatches processing** (new):
   - For each entry, validate userId exists and is active/inactive user
   - Set `users.githubUsername = githubLogin` (warn-and-overwrite already handled client-side)
   - Upsert `githubProfiles` with enriched GitHub data
   - Record `changeHistory` entry for githubUsername update

2. **newUsers processing** (new):
   - For each entry, validate email uniqueness
   - Create user with: name, email, githubUsername = githubLogin, role = "viewer", temp password
   - Upsert `githubProfiles` with enriched GitHub data
   - Record `changeHistory` entry for user creation

3. **Sync event metrics** (updated):
   - Set `manuallyMatchedCount` = count of manualMatches processed
   - Set `createdCount` = count of newUsers processed
   - Existing `matchedCount`, `importedCount`, `unmatchedCount` unchanged

## New Action: `searchUsersForMatching`

**File**: `src/actions/github-sync.ts`

### Signature

```
searchUsersForMatching(input: { query: string; excludeUserIds?: number[] })
  → ActionResult<Array<{
    id: number
    name: string
    email: string
    status: "active" | "inactive"
    githubUsername: string | null
  }>>
```

### Behavior

- Search users by name or email (case-insensitive substring match)
- Include both active and inactive users
- Sort: active users first, then inactive; within each group, alphabetical by name
- Exclude users already matched in the current preview (via `excludeUserIds`)
- Limit results to 20 to keep response fast
- Requires admin session (`requireAdmin()`)

## Unchanged Actions

- `fetchGitHubSyncPreview()` — no changes needed; already returns `SyncUnmatchedMember[]` and `SyncUnmatchedSystemUser[]` with all data needed for client-side suggestion scoring
- `getSyncHistory()` — may need minor update to include new metric columns in response
