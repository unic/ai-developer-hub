# Research: GitHub User Enrichment

**Feature Branch**: `012-github-user-enrichment`
**Date**: 2026-03-06

## Decision 1: GitHub REST API Endpoints

**Decision**: Use four GitHub REST API endpoints with Classic PAT authentication.

**Endpoints**:
1. `GET /user/orgs` — List orgs for authenticated user (requires `read:org`)
2. `GET /orgs/{org}/members?per_page=100` — List org members, paginated (requires `read:org`)
3. `GET /users/{username}` — Get full user profile (requires `read:user` for email)
4. `GET /rate_limit` — Check remaining rate budget

**Key fields from `/users/{username}`**: `login`, `id`, `name`, `email`, `avatar_url`, `bio`, `public_repos`, `html_url`

**Rationale**: REST API is simpler than GraphQL for this use case. The member list endpoint only returns basic info (login, id, avatar_url), so a second call to `/users/{username}` is needed per member to get full profile data (name, email, bio, public_repos).

**Alternatives considered**: GraphQL (single query for all fields, but adds complexity and a different auth model). Rejected for simplicity.

## Decision 2: Pagination & Rate Limit Strategy

**Decision**: Paginate with `per_page=100`, track rate limits via response headers, pause and inform admin if limits approached.

**Details**:
- Authenticated Classic PAT: 5,000 requests/hour
- For 500 members: 5 pages (member list) + 500 individual profile fetches = ~505 requests
- Rate limit headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- If `X-RateLimit-Remaining` < 100, pause sync and display remaining wait time to admin

**Rationale**: 505 requests is well within the 5,000/hour limit for a single sync. Checking headers after each batch prevents hitting hard limits.

## Decision 3: Token Scope Validation

**Decision**: Validate scopes by making an initial `GET /user/orgs` request and checking the `X-OAuth-Scopes` response header.

**Details**:
- `X-OAuth-Scopes` header returns comma-separated list of granted scopes
- Confirm both `read:org` and `read:user` are present
- If scopes missing, return specific error identifying which scope is missing

**Rationale**: No dedicated scope-check endpoint exists. The orgs endpoint serves double duty: validates token + returns available organizations.

## Decision 4: Encryption of GitHub PAT

**Decision**: Reuse existing `encryptApiKey`/`decryptApiKey` from `src/lib/crypto.ts`.

**Details**:
- AES-256-GCM encryption with scrypt key derivation
- Uses `API_KEY_ENCRYPTION_SECRET` env variable (already configured)
- Stored as base64 string (salt + iv + tag + ciphertext)
- Existing pattern used for license assignment API keys (varchar 700)

**Rationale**: No reason to introduce a second encryption mechanism. Same security requirements.

## Decision 5: Member-to-User Matching Strategy

**Decision**: Two-pass matching — GitHub username first, then email fallback.

**Details**:
- Pass 1: Match `githubMember.login` against `users.githubUsername` (case-insensitive)
- Pass 2: For unmatched members, match `githubMember.email` against `users.email` (case-insensitive)
- Cross-match conflicts (username→UserA, email→UserB): username wins, email conflict flagged
- Duplicate matches (two users with same githubUsername): flagged for admin resolution

**Rationale**: Username is the explicit, intentional link set by admins. Email is a coincidental match that serves as a useful fallback.

## Decision 6: Profile Data Fetching Approach

**Decision**: Batch-fetch full profiles after member list is retrieved, with progress reporting.

**Details**:
- Step 1: Fetch all paginated member pages (5 requests for 500 members)
- Step 2: For each member, fetch `/users/{login}` to get full profile
- Step 3: Report progress to frontend (e.g., "Fetched 150/500 profiles...")
- Use sequential requests with small delays to avoid burst rate limiting

**Rationale**: The member list endpoint only returns login/id/avatar_url. Full profile data (name, email, bio, public_repos) requires individual user fetches. No batch endpoint exists.

## Decision 7: Navigation Placement

**Decision**: Add GitHub integration under Settings as `/settings/integrations`.

**Details**:
- Settings already exists at `/settings/appearance`
- Add `/settings/integrations` as a new settings sub-page
- Add a settings layout with sub-navigation (Appearance | Integrations)
- Keep existing sidebar nav item pointing to `/settings/appearance` — settings sub-nav handles routing

**Rationale**: Integrations are a system-level configuration, naturally grouped with settings. Avoids cluttering the main sidebar.

## Decision 8: New Environment Variable

**Decision**: Add `GITHUB_PAT` is NOT stored as env var — it's stored encrypted in the database per-connection.

**Details**:
- No new environment variables needed for this feature
- The PAT is user-provided at runtime and stored encrypted in the `github_connections` table
- Existing `API_KEY_ENCRYPTION_SECRET` handles encryption

**Rationale**: Env vars are static and don't support the dynamic connect/disconnect lifecycle.
