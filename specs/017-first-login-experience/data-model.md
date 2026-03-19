# Data Model: 017 First Login Experience

**Date**: 2026-03-17

## Schema Changes

### Modified Table: `users`

**New column:**

| Column | Type | Default | Nullable | Description |
|--------|------|---------|----------|-------------|
| `must_change_password` | `boolean` | `true` | No | Whether the user must complete password setup before accessing the app. Set to `false` after successful password setup via invite link. |

**Behavior:**
- New users created via admin form or bulk import: `must_change_password = true`
- After user sets password via invite link: `must_change_password = false`
- After admin resets password: `must_change_password = true`
- Seed admin on migration: `must_change_password = false` (exempt)

**Impact on existing queries:**
- `getUsers()` — no change needed (column is informational for the list)
- `createUser()` — no explicit set needed (default handles it)
- Auth `authorize()` — must check this flag and reject with specific message if `true`

### New Table: `invite_tokens`

| Column | Type | Default | Nullable | Description |
|--------|------|---------|----------|-------------|
| `id` | `serial` | auto | No | Primary key |
| `user_id` | `integer` | — | No | FK → `users.id`. Unique constraint (one active token per user). |
| `token_hash` | `varchar(64)` | — | No | SHA-256 hash of the raw token. Indexed for fast lookup. |
| `status` | `enum('active', 'consumed', 'invalidated')` | `'active'` | No | Token lifecycle state. |
| `expires_at` | `timestamp` | — | No | Expiration time (72 hours from creation). |
| `created_at` | `timestamp` | `now()` | No | When the token was generated. |
| `consumed_at` | `timestamp` | — | Yes | When the user successfully set their password. |

**Enum: `invite_token_status`**
- `active` — Token is valid and can be used.
- `consumed` — Token was used to set a password. Terminal state.
- `invalidated` — Token was replaced by a newer token or expired. Terminal state.

**Constraints:**
- Unique index on `(user_id)` WHERE `status = 'active'` — ensures only one active token per user.
- Index on `token_hash` — for fast lookup during password setup.
- FK `user_id` → `users.id` ON DELETE CASCADE.

**State transitions:**
```
[created] → active
active → consumed     (user sets password)
active → invalidated  (admin generates new token, or token expires)
```

**Operations:**
- **Create token**: Insert new row with `status = 'active'`. First, set any existing `active` token for the same user to `invalidated`.
- **Validate token**: Look up by `token_hash` where `status = 'active'` and `expires_at > now()`.
- **Consume token**: Set `status = 'consumed'`, `consumed_at = now()`.
- **Invalidate**: Set `status = 'invalidated'` (done when generating a replacement token).

## Migration Plan

### Migration 0009: Add first-login-experience schema

1. Create `invite_token_status` enum.
2. Create `invite_tokens` table with all columns and constraints.
3. Add `must_change_password` column to `users` table with default `true`.
4. Set `must_change_password = false` for the seed admin (`admin@company.com`).
5. Generate invite tokens for all existing users where `must_change_password = true`:
   - For each user, generate a random token, hash it, insert into `invite_tokens`.
   - The raw tokens are not recoverable from the migration — the admin will use "Send Invites to All Pending Users" to generate fresh tokens and send emails.

**Note on step 5**: Since the migration can't output raw tokens and we don't want to store them in plain text, the migration creates placeholder `active` tokens that will be regenerated when the admin sends batch invites (FR-020 handles this — expired or regenerated tokens are replaced automatically).

**Simplified alternative for step 5**: Skip pre-generating tokens in the migration. Just set `must_change_password = true`. When the admin clicks "Send Invites to All Pending Users", the system generates tokens on-demand for users who don't have an active one. This is simpler and avoids creating tokens that will never be used directly.

**Recommended**: Simplified alternative (skip step 5). Migration only does steps 1–4.

## Entity Relationships

```
users 1 ←→ 0..1 invite_tokens (active)
users 1 ←→ 0..* invite_tokens (all, including consumed/invalidated history)
```

## Validation Rules

| Entity | Field | Rule |
|--------|-------|------|
| invite_tokens | token_hash | 64-char hex string (SHA-256 of 32-byte random) |
| invite_tokens | expires_at | Must be in the future at creation (72 hours from now) |
| invite_tokens | user_id | Must reference an existing, active user |
| users | must_change_password | Boolean, no validation beyond type |
| Password (input) | new password | Minimum 8 characters (Zod validation, matches existing `userSchema`) |
| Password (input) | confirm password | Must match new password |
