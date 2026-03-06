# Implementation Plan: Bulk User Import with Upsert & Export

**Branch**: `011-user-import` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-user-import/spec.md`

## Summary

Enhance the existing bulk user import to support upsert behavior: when a CSV row's email matches an existing user, update their fields (name, circle, role, github_username, profile) without changing their password or status. New emails create new users as before. Add an export button to the user overview page. The import preview must distinguish "New" vs "Update" rows and highlight changed fields.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, shadcn/ui (new-york), Sonner (toasts), Lucide React, bcryptjs, Zod 4.3.6
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` + Drizzle ORM
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (server-rendered Next.js)
**Project Type**: Web application (Next.js App Router with Server Actions)
**Performance Goals**: Standard web app — bulk import of 100+ users completes within seconds
**Constraints**: No new dependencies required; all changes use existing stack
**Scale/Scope**: Admin-only feature, typical usage 10-500 users per import

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. Zod schemas for validation. Server action return types follow existing `ActionResult<T>` pattern. |
| II. UX Consistency | PASS | Uses existing shadcn/ui components (Button, Badge, Table). New/Update badges follow existing badge patterns. Export button follows existing button group layout. |
| III. Performance Budgets | PASS | No new routes or pages. Changes to existing import page are minimal. No new JS bundles. Server-side upsert logic runs on Neon serverless. |
| IV. Accessibility-First | PASS | Export button is a standard `<a>` or `<Button>` with accessible label. Preview table uses existing accessible DataTable. Status badges use text labels (not color-only). |
| V. Simplicity & Maintainability | PASS | Extends existing server action rather than creating new abstraction. Reuses existing CSV parsing, export API, change history recording. No new dependencies. |

**Gate result**: ALL PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/011-user-import/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── server-actions.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   └── users.ts              # MODIFY: upsert logic in bulkImportUsers
├── app/
│   ├── users/
│   │   ├── page.tsx           # MODIFY: add export button
│   │   └── import/
│   │       └── bulk-import-form.tsx  # MODIFY: preview with New/Update indicators, change highlighting
│   └── api/export/users/
│       └── route.ts           # NO CHANGE: existing export API
├── lib/
│   ├── validators.ts          # MODIFY: add upsert result types
│   └── csv.ts                 # NO CHANGE: existing CSV utilities
└── types/
    └── index.ts               # MODIFY: add BulkImportResult types

tests/
├── unit/
│   └── bulk-import-upsert.test.ts   # NEW: unit tests for upsert logic
└── e2e/
    └── bulk-import-upsert.spec.ts   # NEW: e2e tests for export-edit-import workflow
```

**Structure Decision**: This feature modifies existing files in the established Next.js App Router structure. No new pages or routes are needed — only modifications to the existing bulk import action, form component, and user overview page.
