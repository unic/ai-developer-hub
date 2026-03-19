# Implementation Plan: First Login Experience

**Branch**: `017-first-login-experience` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-first-login-experience/spec.md`

## Summary

Implement a self-service password setup flow for new users via secure, time-limited invite links. Admins create users without passwords — the system generates invite tokens, and admins control when invite emails are sent (never automatic). Includes a modern redesigned auth page, admin password reset with email option, batch invite sending for all pending users, and rate limiting for abuse protection. Uses Resend for email delivery with React Email templates.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, NextAuth 5.0.0-beta.30, Drizzle ORM 0.45.1, bcryptjs 3.0.3, Zod 4.3.6, React Hook Form 7.71.2, shadcn/ui (new-york), Sonner (toasts), Lucide React. **NEW**: resend, @react-email/components
**Storage**: Neon PostgreSQL (serverless) via @neondatabase/serverless — 1 new table (`invite_tokens`), 1 modified table (`users` + `must_change_password` column), 1 new enum (`invite_token_status`)
**Testing**: Vitest (unit/integration), Playwright (e2e), @lhci/cli (Lighthouse CI)
**Target Platform**: Web (Next.js on Vercel/Node.js)
**Project Type**: Web application (full-stack Next.js)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle < 150KB gzipped per route
**Constraints**: Single-instance deployment, <500 users, internal admin tool
**Scale/Scope**: <500 users, <10 concurrent admins, batch emails up to ~500 at once (synchronous)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. New Zod schemas for invite token validation. Unit tests for rate limiter, token utils. |
| II. UX Consistency | PASS | Auth pages use shadcn/ui components, Tailwind design tokens, existing theme system. Modern redesign follows the design system. |
| III. Performance Budgets | PASS | Auth pages are lightweight (form + card). Email template is server-rendered. No heavy client bundles. Rate limiter is in-memory (zero latency). |
| IV. Accessibility-First | PASS | Auth forms use semantic HTML, shadcn/ui provides focus rings and ARIA. Password setup page needs keyboard navigation and visible focus. |
| V. Simplicity & Maintainability | PASS | In-memory rate limiter (~50 LOC), single email service abstraction, token utils in one file. No new frameworks or complex patterns. Only 2 new dependencies (resend, @react-email/components). |

**Post-Phase 1 re-check**: All gates still pass. Data model is minimal (1 new table, 1 new column). No over-engineering — token hashing uses built-in Node.js crypto, rate limiting is a Map.

## Project Structure

### Documentation (this feature)

```text
specs/017-first-login-experience/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 developer quickstart
├── contracts/
│   └── server-actions.md # Phase 1 server action contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   ├── invite.ts                          # NEW: invite token + email server actions
│   └── users.ts                           # MODIFIED: remove password from create, add invite flow
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx                     # MODIFIED: updated modern auth layout
│   │   ├── login/
│   │   │   ├── login-form.tsx             # MODIFIED: modern redesign
│   │   │   └── page.tsx                   # MODIFIED: updated layout/content
│   │   └── setup-password/
│   │       └── [token]/
│   │           ├── page.tsx               # NEW: token validation + password setup page
│   │           └── setup-password-form.tsx # NEW: password setup form (client component)
│   └── users/
│       ├── users-table.tsx                # MODIFIED: pending status, invite actions
│       ├── new/
│       │   └── new-user-form.tsx          # MODIFIED: remove password, show invite link
│       └── import/
│           └── bulk-import-form.tsx       # MODIFIED: invite tokens, downloadable list
├── components/
│   └── invite-link-dialog.tsx             # NEW: copy link + send email dialog
├── emails/
│   └── invite-email.tsx                   # NEW: React Email invite template
├── lib/
│   ├── auth.ts                            # MODIFIED: check mustChangePassword
│   ├── db/
│   │   └── schema.ts                      # MODIFIED: invite_tokens table, mustChangePassword column
│   ├── email.ts                           # NEW: Resend service wrapper
│   ├── invite.ts                          # NEW: token generation/validation utils
│   ├── rate-limit.ts                      # NEW: in-memory rate limiter
│   └── validators.ts                      # MODIFIED: add setupPasswordSchema
└── middleware.ts                           # UNCHANGED (no middleware changes needed)
```

**Structure Decision**: Follows existing Next.js App Router conventions. New files placed alongside existing patterns — actions in `src/actions/`, library utils in `src/lib/`, pages under `src/app/`. Email templates in new `src/emails/` directory (React Email convention). No new top-level directories beyond `src/emails/`.

## Complexity Tracking

No constitution violations — no justifications needed.
