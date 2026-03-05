# Implementation Plan: Bulk License Import, API Key Management & User Profile Extension

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-bulk-license-import/spec.md`

## Summary

Add three capabilities to the AI Developer Hub: (1) bulk CSV import for license assignments that resolves users by email and tools/tiers by name, validates all rows with a preview, and commits each row individually with best-effort error handling; (2) API key add/update/clear controls on the assignment detail page for admins; (3) a new optional `profile` field on users (Boost / Maxed / Indie) surfaced on the user detail, creation form, users list, and bulk user import.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui + radix-ui, React Hook Form 7.71.2, Zod 4.3.6, date-fns 4.1.0, bcryptjs, sonner (toasts)
**Storage**: Neon PostgreSQL (serverless) via @neondatabase/serverless 1.0.2 + Drizzle ORM
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Node.js server + browser client)
**Project Type**: Full-stack Next.js web application
**Performance Goals**: Import 50 assignments in < 30 seconds end-to-end (SC-001)
**Constraints**: API keys encrypted with AES-256-GCM via API_KEY_ENCRYPTION_SECRET env var; monetary values stored as integer cents
**Scale/Scope**: Internal admin tool; CSV imports expected up to ~500 rows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | ✅ Pass | All new code TypeScript strict; new Zod schemas for bulk import validation; new enum type for profile |
| II. UX Consistency | ✅ Pass | All new UI uses existing shadcn/ui components (Table, Card, Badge, Select, Input, Button); follows existing bulk import pattern from users |
| III. Performance Budgets | ✅ Pass | New pages are server-rendered with minimal client JS; CSV parsing is client-side; no heavy bundle additions |
| IV. Accessibility-First | ✅ Pass | Uses semantic HTML via shadcn/ui; file input, table, form controls all keyboard-navigable; error states communicated via Badge + toast |
| V. Simplicity & Maintainability | ✅ Pass | Follows existing patterns exactly (bulk user import → bulk assignment import); no new abstractions; profile is a simple enum column |

No violations. No complexity tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/004-bulk-license-import/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── assignments/
│   │   ├── import/                    # NEW — bulk license assignment import page
│   │   │   ├── page.tsx               # Server component (admin gate)
│   │   │   └── bulk-assignment-import-form.tsx  # Client component (CSV upload, preview, import)
│   │   └── [id]/
│   │       └── assignment-detail-client.tsx     # MODIFIED — add API key edit controls
│   ├── users/
│   │   ├── import/
│   │   │   └── bulk-import-form.tsx    # MODIFIED — add profile column support
│   │   ├── new/
│   │   │   └── new-user-form.tsx       # MODIFIED — add profile dropdown
│   │   ├── users-table.tsx             # MODIFIED — add profile column
│   │   └── [id]/
│   │       └── user-detail-client.tsx  # MODIFIED — add profile edit field
├── actions/
│   ├── assignments.ts                  # MODIFIED — add bulkImportAssignments, updateAssignmentApiKey
│   └── users.ts                        # MODIFIED — add profile to createUser, updateUser, bulkImport
├── lib/
│   ├── db/
│   │   └── schema.ts                   # MODIFIED — add userProfileEnum, profile column to users
│   └── validators.ts                   # MODIFIED — add bulk assignment import schema, profile to user schemas
└── types/
    └── index.ts                        # MODIFIED — add UserProfile type

tests/
├── unit/
│   └── bulk-assignment-import.test.ts  # NEW — CSV parsing, validation logic
└── e2e/
    └── bulk-assignment-import.spec.ts  # NEW — end-to-end import flow
```

**Structure Decision**: Extends existing Next.js App Router structure. New import page follows the established pattern at `src/app/users/import/`. All modifications are to existing files within the established architecture.
