# Server Action Contracts: GitHub User Enrichment

**Feature Branch**: `012-github-user-enrichment`
**Date**: 2026-03-06

All actions follow the existing `ActionResult<T>` pattern and require admin role.

## Connection Actions (`src/actions/github.ts`)

### `validateGitHubToken(input: unknown)`

Validates a Classic PAT and returns available organizations. Does NOT persist anything.

**Input** (Zod validated):
```typescript
{ token: string } // raw PAT, min 1 char
```

**Output**:
```typescript
ActionResult<{
  scopes: string[];
  organizations: Array<{
    login: string;
    id: number;
    avatarUrl: string | null;
    description: string | null;
  }>;
}>
```

**Errors**: "Unauthorized", "Invalid token", "Token missing required scopes: read:org, read:user"

---

### `connectGitHubOrg(input: unknown)`

Connects a GitHub organization. Encrypts and stores the token. Disconnects any previously active connection.

**Input** (Zod validated):
```typescript
{
  token: string;   // raw PAT
  orgLogin: string; // selected org login
  orgId: number;    // selected org ID
}
```

**Output**:
```typescript
ActionResult<{ connectionId: number }>
```

**Side effects**: Encrypts token, inserts `github_connections` row, disconnects any prior active connection (transaction), records change history, revalidates `/settings/integrations`.

---

### `disconnectGitHubOrg()`

Disconnects the active GitHub organization connection.

**Input**: None

**Output**:
```typescript
ActionResult<void>
```

**Side effects**: Sets status = "disconnected", clears token, sets disconnectedAt. Does NOT delete `github_profiles` data (FR-011). Records change history, revalidates path.

---

### `updateGitHubToken(input: unknown)`

Updates the PAT for the active connection.

**Input** (Zod validated):
```typescript
{ token: string } // new raw PAT
```

**Output**:
```typescript
ActionResult<void>
```

**Side effects**: Validates new token scopes and org access, encrypts and updates token. Records change history.

---

## Sync Actions (`src/actions/github-sync.ts`)

### `fetchGitHubSyncPreview()`

Fetches org members from GitHub and computes the match preview. Does NOT persist changes.

**Input**: None (uses active connection)

**Output**:
```typescript
ActionResult<{
  syncEventId: number; // created in_progress sync event for tracking
  totalMembers: number;
  matched: Array<{
    githubLogin: string;
    githubId: number;
    githubName: string | null;
    githubAvatarUrl: string | null;
    githubBio: string | null;
    githubPublicRepos: number | null;
    githubProfileUrl: string;
    githubEmail: string | null;
    matchedUserId: number;
    matchedUserName: string;
    matchedUserEmail: string;
    matchType: "username" | "email";
    hasConflict: boolean;
    conflictDetail: string | null;
  }>;
  unmatched: Array<{
    githubLogin: string;
    githubId: number;
    githubName: string | null;
    githubAvatarUrl: string | null;
    githubBio: string | null;
    githubPublicRepos: number | null;
    githubProfileUrl: string;
    githubEmail: string | null;
  }>;
  unmatchedSystemUsers: Array<{
    userId: number;
    userName: string;
    userEmail: string;
    githubUsername: string | null;
  }>;
  conflicts: Array<{
    githubLogin: string;
    usernameMatchUserId: number;
    emailMatchUserId: number;
    detail: string;
  }>;
  rateLimitRemaining: number;
}>
```

**Errors**: "No active GitHub connection", "Token invalid or expired", "Rate limit exceeded"

---

### `confirmGitHubSync(input: unknown)`

Applies the sync — enriches matched users and optionally imports selected unmatched members.

**Input** (Zod validated):
```typescript
{
  syncEventId: number;
  importGitHubLogins: string[]; // logins of unmatched members to import as new users
}
```

**Output**:
```typescript
ActionResult<{
  enrichedCount: number;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
}>
```

**Side effects**:
- Upserts `github_profiles` for matched users
- Updates `users.githubUsername` where matched by email and field was empty
- Creates new users for selected imports (viewer role, active status, temp password)
- Records all changes in change history (per-field before/after)
- Updates sync event with final counts and status
- Updates connection's `lastSyncAt`
- Revalidates `/users`, `/settings/integrations`

---

## Query Actions

### `getActiveGitHubConnection()`

Returns the active connection (if any) for display in settings.

**Output**:
```typescript
ActionResult<{
  connection: {
    id: number;
    orgLogin: string;
    orgAvatarUrl: string | null;
    status: string;
    connectedAt: Date;
    lastSyncAt: Date | null;
  } | null;
}>
```

---

### `getGitHubProfile(userId: number)`

Returns the cached GitHub profile for a user (for the user detail page).

**Output**:
```typescript
ActionResult<{
  profile: {
    githubLogin: string;
    avatarUrl: string | null;
    bio: string | null;
    publicRepos: number | null;
    profileUrl: string | null;
    name: string | null;
    lastSyncedAt: Date;
  } | null;
}>
```

---

### `getSyncHistory(limit?: number)`

Returns recent sync events for the integrations settings page.

**Output**:
```typescript
ActionResult<{
  events: Array<{
    id: number;
    status: string;
    totalMembers: number | null;
    matchedCount: number | null;
    importedCount: number | null;
    unmatchedCount: number | null;
    startedAt: Date;
    completedAt: Date | null;
    triggeredByName: string;
  }>;
}>
```
