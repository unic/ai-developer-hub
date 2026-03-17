# Implementation Plan: GitHub Member Sync — Manual Matching

**Branch**: `015-github-member-sync` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-github-member-sync/spec.md`

## Summary

Extend the existing GitHub org member sync preview to support manual resolution of unmatched members. Admins can match unmatched GitHub members to existing application users, create new users inline with pre-filled GitHub data, or skip. Manual matches persist the GitHub username on the user record, ensuring auto-matching in future syncs. The feature adds a `string-similarity` dependency for match suggestions, extends the `confirmGitHubSync` server action, and introduces new UI components (user search combobox, inline creation form, unmatched member cards) within the existing sync preview page.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, shadcn/ui (new-york), cmdk 1.1.1, string-similarity (NEW)
**Storage**: Neon PostgreSQL (serverless) — 2 new columns on existing table
**Testing**: Vitest (unit), Playwright (e2e)
**Target Platform**: Web (Next.js server + client)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Match suggestion scoring < 50ms for 500 users; search combobox responsive at < 100ms
**Constraints**: All mutations atomic within single sync confirmation; no new tables
**Scale/Scope**: Orgs up to 500 members; up to 100 unmatched members in a single sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new types defined with strict typing; Zod schemas for validation; no `any` usage |
| II. UX Consistency | PASS | Uses existing shadcn/ui components (Command, Popover, Dialog); follows established table patterns; consistent badges and visual markers |
| III. Performance Budgets | PASS | Client-side similarity scoring avoids server round-trips; search combobox uses server action with 20-result limit; no new routes/bundles beyond existing integrations page |
| IV. Accessibility-First | PASS | Command component has built-in keyboard navigation; inline forms use standard form elements; focus management on expand/collapse; status indicators not color-only |
| V. Simplicity & Maintainability | PASS | No new tables; extends existing action instead of creating parallel flow; client-side state management uses simple Map; one new lightweight dependency |

**Post-Phase 1 Re-check**: All gates still pass. `string-similarity` is 2KB with zero transitive dependencies. No new route added — feature extends existing `/settings/integrations` page.

## Project Structure

### Documentation (this feature)

```text
specs/015-github-member-sync/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Schema changes and client types
├── quickstart.md        # Setup and verification guide
├── contracts/
│   └── server-actions.md # Server action API contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   └── github-sync.ts          # MODIFY: extend confirmGitHubSync, add searchUsersForMatching
├── app/
│   └── settings/
│       └── integrations/
│           └── github-integration-client.tsx  # MODIFY: add manual matching UI flow
├── components/
│   ├── user-search-combobox.tsx     # NEW: searchable user picker (Command + Popover)
│   ├── inline-user-form.tsx         # NEW: compact inline user creation form
│   └── unmatched-member-card.tsx    # NEW: resolution card per unmatched member
├── lib/
│   ├── db/
│   │   └── schema.ts               # MODIFY: add 2 columns to githubSyncEvents
│   ├── match-suggestions.ts        # NEW: client-side similarity scoring
│   └── validators.ts               # MODIFY: add manual match + inline creation schemas
└── types/
    └── index.ts                     # MODIFY: add PendingResolution, MatchSuggestion, ResolutionSummary types

tests/
├── unit/
│   └── match-suggestions.test.ts   # NEW: similarity scoring tests
└── e2e/
    └── github-sync-matching.spec.ts # NEW: manual matching E2E flow
```

**Structure Decision**: Extends existing Next.js App Router structure. New components are placed in `src/components/` (not `src/components/ui/`) since they are feature-specific, not design-system primitives. The existing integrations page is modified rather than creating a new route.

## Complexity Tracking

No constitution violations to justify.
