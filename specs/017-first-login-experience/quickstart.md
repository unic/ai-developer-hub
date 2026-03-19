# Quickstart: 017 First Login Experience

## Prerequisites

- Node.js LTS, pnpm
- Neon PostgreSQL database (existing)
- Resend account with verified domain (NEW)

## Environment Setup

Add to `.env.local`:

```bash
# Existing
DATABASE_URL=...
AUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# New for this feature
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=noreply@yourdomain.com
```

## New Dependencies

```bash
pnpm add resend @react-email/components
```

## Database Migration

```bash
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Apply migration (adds must_change_password column + invite_tokens table)
```

## New Files

| File | Purpose |
|------|---------|
| `src/lib/email.ts` | Resend email service wrapper |
| `src/lib/rate-limit.ts` | In-memory rate limiter |
| `src/lib/invite.ts` | Token generation/validation utilities |
| `src/emails/invite-email.tsx` | React Email invite template |
| `src/actions/invite.ts` | Invite token server actions |
| `src/app/(auth)/setup-password/[token]/page.tsx` | Password setup page (public) |
| `src/app/(auth)/setup-password/[token]/setup-password-form.tsx` | Password setup form component |

## Modified Files

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `mustChangePassword` to users, new `inviteTokens` table |
| `src/lib/validators.ts` | Add `setupPasswordSchema`, `inviteTokenSchema` |
| `src/lib/auth.ts` | Check `mustChangePassword` flag, reject pending users with specific message |
| `src/actions/users.ts` | Remove password from create, generate invite token, return invite URL |
| `src/app/(auth)/login/login-form.tsx` | Redesigned modern UI |
| `src/app/(auth)/layout.tsx` | Updated auth layout for modern design |
| `src/app/users/users-table.tsx` | Add pending status indicator, send invite/reset actions |
| `src/app/users/new/new-user-form.tsx` | Remove password field, show invite link after creation |
| `src/app/users/import/bulk-import-form.tsx` | Generate tokens, downloadable invite list |

## Development Flow

1. Apply schema changes and run migration
2. Implement token utilities (`src/lib/invite.ts`)
3. Implement rate limiter (`src/lib/rate-limit.ts`)
4. Implement email service and template
5. Build password setup page and form
6. Modify auth to check pending status
7. Update user creation to use invite flow
8. Redesign login page
9. Add admin actions (reset password, send invites, batch send)
10. Update user management UI (status indicators, actions)

## Testing

```bash
pnpm test                # Unit tests (rate limiter, token utils, validators)
pnpm test:integration    # Integration tests (token CRUD, email sending, auth flow)
pnpm test:e2e           # E2E tests (full invite → setup → login flow)
```
