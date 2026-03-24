# Implementation Plan: UI Enhancements — Assignment & User Detail Polish

**Branch**: `021-ui-enhancements` | **Date**: 2026-03-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/021-ui-enhancements/spec.md`

## Summary

Four targeted UX improvements to the assignment and user detail pages: (1) make assigned tool entries clickable links to assignment detail, (2) merge the duplicated detail-card and edit-form on the assignment detail page into a single unified view, (3) remove the server-side validation that prevents assignment dates before user creation, and (4) add optional workspace and API key fields to the new-assignment creation dialog. No new dependencies. No schema changes — all required columns already exist.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, React Hook Form 7.71.2, Zod 4.3.6, shadcn/ui (new-york), Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via Drizzle ORM 0.45.1 — no schema changes
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Next.js SSR)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle per route < 150 KB gzipped
**Constraints**: All UI must use shadcn/ui components and Tailwind design tokens only
**Scale/Scope**: 4 files modified, ~200 lines changed, 0 new files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All changes are TypeScript strict. Zod schemas extended with proper types. No `any` usage. |
| II. UX Consistency | PASS | Unified assignment detail follows existing user detail patterns. Link components use standard Next.js Link. shadcn/ui primitives throughout. |
| III. Performance Budgets | PASS | No new dependencies. No additional JS bundle. Link component adds negligible weight. Removing a card section reduces DOM size. |
| IV. Accessibility-First | PASS | Using semantic `<Link>` for navigation (keyboard navigable, screen reader friendly). Form fields use existing accessible shadcn/ui components with labels and error messages. |
| V. Simplicity & Maintainability | PASS | Net reduction in code — merging two cards into one removes ~120 lines of duplication. Validation change is a deletion. Schema extension adds 2 optional fields. |

**Pre-design gate**: PASSED — no violations.

**Post-design re-check**: PASSED — design phase confirmed no new dependencies, no new abstractions, no schema changes.

## Project Structure

### Documentation (this feature)

```text
specs/021-ui-enhancements/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── server-actions.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (files to modify)

```text
src/
├── app/
│   ├── users/[id]/
│   │   └── user-detail-client.tsx    # Add Link wrappers + workspace/apiKey fields in dialog
│   └── assignments/[id]/
│       └── assignment-detail-client.tsx  # Merge detail + edit cards into unified view
├── actions/
│   └── assignments.ts                # Remove user-creation-date check; add workspace/apiKey to assignLicense
└── lib/
    └── validators.ts                 # Extend assignmentSchema with workspace + apiKey

tests/
├── unit/
│   └── assignments.test.ts           # Update tests for removed validation + new fields
└── integration/
    └── assignments.test.ts           # Update integration tests
```

**Structure Decision**: Existing Next.js App Router structure. No new files or directories — all changes are modifications to 4 existing source files plus test updates.

## Complexity Tracking

> No violations to justify. All changes are deletions or minimal additions to existing files.
