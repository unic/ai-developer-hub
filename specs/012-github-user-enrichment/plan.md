# Implementation Plan: GitHub User Enrichment

**Branch**: `012-github-user-enrichment` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-github-user-enrichment/spec.md`

## Summary

Add GitHub organization integration to the AI Developer Hub. Admins connect a GitHub org via Classic PAT, sync members to enrich existing user profiles with GitHub data (avatar, bio, repos, profile URL), and optionally import unmatched members as new users. Uses existing encryption, change history, and server action patterns.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, Zod 4.3.6, shadcn/ui (new-york), Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — 3 new tables
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Node.js server, browser client)
**Project Type**: Web service (Next.js full-stack)
**Performance Goals**: Sync 500 members within GitHub API rate limits (~505 requests, well under 5,000/hour)
**Constraints**: No new dependencies for GitHub API (use native `fetch`), reuse existing encryption
**Scale/Scope**: Single org connection, up to 500 members, manual sync only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | TypeScript strict mode, Zod validation, exported types for all new entities |
| II. UX Consistency | PASS | Uses shadcn/ui components, design tokens, consistent patterns (toasts, tables, forms) |
| III. Performance Budgets | PASS | No new JS bundle concerns — settings page is lightweight. GitHub API calls are server-side only. |
| IV. Accessibility-First | PASS | All new UI uses shadcn/ui primitives with built-in a11y (keyboard nav, ARIA, focus management) |
| V. Simplicity & Maintainability | PASS | No new dependencies. Reuses existing encryption, change history, and action patterns. Single-file GitHub API client. |

**Post-Phase 1 Re-check**: All gates still PASS. Data model adds 3 focused tables with clear responsibilities. Server actions follow established patterns. No speculative abstractions.

## Project Structure

### Documentation (this feature)

```text
specs/012-github-user-enrichment/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Phase 1 data model design
├── quickstart.md        # Phase 1 developer quickstart
├── contracts/
│   └── server-actions.md # Phase 1 server action contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── db/
│   │   └── schema.ts          # + github_connections, github_profiles, github_sync_events tables
│   ├── github.ts              # NEW: GitHub REST API client (fetch wrapper)
│   ├── validators.ts          # + github token, connection, sync schemas
│   ├── crypto.ts              # EXISTING: reused for PAT encryption
│   └── utils.ts               # EXISTING: no changes
├── actions/
│   ├── github.ts              # NEW: connection management actions
│   ├── github-sync.ts         # NEW: sync preview + confirm actions
│   └── history.ts             # EXISTING: reused for change tracking
├── app/
│   ├── settings/
│   │   ├── layout.tsx         # NEW: settings sub-navigation (Appearance | Integrations)
│   │   ├── appearance/
│   │   │   └── page.tsx       # EXISTING: no changes
│   │   └── integrations/
│   │       ├── page.tsx       # NEW: integrations settings page
│   │       └── github-integration-client.tsx  # NEW: client component
│   └── users/
│       └── [id]/
│           └── user-detail-client.tsx  # MODIFIED: add GitHub profile section
├── components/
│   └── app-sidebar.tsx        # EXISTING: no changes needed (settings nav already exists)
└── types/
    └── index.ts               # + GitHub-related type exports

tests/
├── unit/
│   ├── github-client.test.ts  # GitHub API client tests
│   └── github-matching.test.ts # Member-to-user matching logic tests
├── integration/
│   └── github-sync.test.ts   # Sync flow with real DB
└── e2e/
    └── github-integration.test.ts # Full connection + sync + user detail flow
```

**Structure Decision**: Follows existing Next.js App Router structure. New server actions split into `github.ts` (connection CRUD) and `github-sync.ts` (sync operations) for separation of concerns. GitHub API client extracted to `src/lib/github.ts` as a thin fetch wrapper.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
