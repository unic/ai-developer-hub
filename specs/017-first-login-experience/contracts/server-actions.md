# Server Action Contracts: 017 First Login Experience

## Invite Token Actions (`src/actions/invite.ts`)

### `generateInviteToken(userId: number)`

Generates a new invite token for a user, invalidating any existing active token.

**Auth**: Admin only (via `requireAdmin()`).

**Input**:
```typescript
{ userId: number }
```

**Output**:
```typescript
{ success: true; data: { inviteUrl: string } }
| { success: false; error: string }
```

**Side effects**:
- Invalidates existing active token for user (sets `status = 'invalidated'`).
- Inserts new `invite_tokens` row with `status = 'active'`, `expires_at = now + 72h`.
- Sets `users.must_change_password = true`.

---

### `validateInviteToken(token: string)`

Validates a raw invite token from the URL. Does NOT consume it.

**Auth**: None (public endpoint — this is accessed via invite link).

**Input**:
```typescript
{ token: string }  // Raw token from URL
```

**Output**:
```typescript
{ success: true; data: { userName: string; userEmail: string } }
| { success: false; error: 'expired' | 'consumed' | 'invalid' }
```

**Side effects**: None (read-only).

---

### `setupPassword(input)`

Sets the user's password using a valid invite token. Consumes the token and signs the user in.

**Auth**: None (public — token is the auth factor).

**Input**:
```typescript
{
  token: string;          // Raw token from URL
  password: string;       // New password (min 8 chars)
  confirmPassword: string; // Must match password
}
```

**Output**:
```typescript
{ success: true; data: { redirectUrl: string } }
| { success: false; error: string }
```

**Side effects**:
- Validates token (rejects if expired/consumed/invalid).
- Hashes password with bcrypt (salt rounds = 12).
- Updates `users.password_hash` and sets `users.must_change_password = false`.
- Sets token `status = 'consumed'`, `consumed_at = now()`.
- Creates a session for the user (programmatic sign-in).

---

### `resetUserPassword(input)`

Admin action to reset a user's password and optionally send an invite email.

**Auth**: Admin only.

**Input**:
```typescript
{
  userId: number;
  sendEmail: boolean;  // Whether to send invite email
}
```

**Output**:
```typescript
{ success: true; data: { inviteUrl: string; emailSent: boolean } }
| { success: false; error: string }
```

**Side effects**:
- Invalidates user's current password (sets random hash).
- Sets `users.must_change_password = true`.
- Generates new invite token (invalidates previous).
- If `sendEmail = true`, sends invite email via Resend.
- Records action in change history.

---

### `sendInviteEmail(userId: number)`

Sends an invite email to a single user who has an active invite token.

**Auth**: Admin only.

**Input**:
```typescript
{ userId: number }
```

**Output**:
```typescript
{ success: true; data: { emailId: string } }
| { success: false; error: string }
```

**Side effects**:
- Looks up active token for user. If expired, generates a new one first.
- Sends branded email via Resend with invite link.

---

### `sendBatchInviteEmails()`

Sends invite emails to all users with `must_change_password = true`.

**Auth**: Admin only.

**Input**: None.

**Output**:
```typescript
{
  success: true;
  data: {
    sent: number;
    failed: number;
    total: number;
    errors: Array<{ userId: number; email: string; error: string }>;
  }
}
| { success: false; error: string }
```

**Side effects**:
- For each pending user: generates token if missing/expired, sends email.
- Processes synchronously with progress (returns aggregate result).

## Modified Actions

### `createUser()` (`src/actions/users.ts`)

**Changes**:
- Remove `password` field from input. Password is no longer set at creation time.
- Set `passwordHash` to a random value (user can't sign in with it).
- Set `must_change_password = true` (default).
- Generate invite token after user creation.
- Return `inviteUrl` in the response data.

### `bulkImportUsers()` (`src/actions/users.ts`)

**Changes**:
- Remove default password "changeme123" logic.
- Set `passwordHash` to a unique random hash per user.
- Set `must_change_password = true` for all new users.
- Generate invite tokens for all newly created users.
- Return downloadable list of `{ name, email, inviteUrl }` for new users.

## Rate Limiting

### Sign-in rate limit

Applied in the NextAuth credentials `authorize()` callback.

- **Key**: email address (lowercased)
- **Limit**: 5 failed attempts per 10-minute window
- **On limit**: Return `null` with error message "Too many sign-in attempts. Please try again later."
- **On success**: Clear attempt counter for that email

### Password setup rate limit

Applied in the `setupPassword` server action.

- **Key**: Client IP address (from `x-forwarded-for` or `x-real-ip` header)
- **Limit**: 10 attempts per minute
- **On limit**: Return `{ success: false, error: 'Too many attempts' }`
