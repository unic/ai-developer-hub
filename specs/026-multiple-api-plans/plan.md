# Implementation Plan: Multiple Claude API Plan Connections

**Branch**: `026-multiple-api-plans` | **Date**: 2026-03-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/026-multiple-api-plans/spec.md`

## Summary

Extend the application from supporting a single Claude API plan connection (via the `ANTHROPIC_ADMIN_API_KEY` environment variable) to supporting multiple database-backed plan connections. Each plan stores its own encrypted admin API key and label. The sync framework iterates all active plans, resolving user API keys across plans and tracking usage per plan. User-facing profile pages remain unchanged; admin views gain plan labels for cost attribution. Budget views are completely unaffected. Existing data is migrated to the auto-imported first plan.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, NextAuth 5.0.0-beta.30, shadcn/ui (new-york), Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — 1 new table (`anthropic_plan_connections`), 4 modified tables (`anthropic_usage_metrics`, `anthropic_sync_status`, `anthropic_workspaces`, `anthropic_workspace_costs`), `sync_events` gains optional column
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Node.js server + browser client)
**Project Type**: Web service (Next.js App Router)
**Performance Goals**: Sync completes within existing timeouts; no added latency to profile page loads
**Constraints**: Encryption uses existing AES-256-GCM via `API_KEY_ENCRYPTION_SECRET`; max 10 plans per organization
**Scale/Scope**: ~4 modified pages, ~6 modified server-side modules, 1 new table, 1 migration script

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. New table schemas use Drizzle typed definitions. Zod validation for plan connection inputs. |
| II. UX Consistency | PASS | Uses existing shadcn/ui components (Card, Dialog, Input, Button, Badge). Plan management UI follows existing integrations page patterns. |
| III. Performance Budgets | PASS | No new routes that would affect LCP/INP/CLS. Plan list is admin-only, low cardinality (max 10). Sync iteration adds O(n) where n ≤ 10. |
| IV. Accessibility-First | PASS | All new UI elements use shadcn/ui primitives with built-in keyboard navigation, focus management, and ARIA attributes. |
| V. Simplicity & Maintainability | PASS | Extends existing patterns (encryption, sync framework, server actions) rather than introducing new abstractions. No new dependencies. |

**Post-Phase 1 Re-check**: All gates still pass. No new violations introduced by data model or contract design.

## Project Structure

### Documentation (this feature)

```text
specs/026-multiple-api-plans/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-contracts.md # Server action contracts
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── settings/integrations/     # Extended: plan connections management UI
│   ├── claude/                    # Extended: multi-plan workspace aggregation
│   ├── users/[id]/                # Extended: plan label on cost section
│   └── api/sync/                  # Extended: plan-aware sync routes
├── actions/
│   ├── plan-connections.ts        # NEW: CRUD server actions for plan connections
│   └── anthropic-usage.ts         # Modified: plan-aware cost queries
├── components/
│   ├── settings/
│   │   └── plan-connections-card.tsx  # NEW: plan management UI component
│   └── claude/
│       └── global-metrics-client.tsx  # Modified: plan filter support
├── lib/
│   ├── db/
│   │   └── schema.ts              # Modified: new table + column additions
│   ├── sync/
│   │   ├── sources/
│   │   │   ├── anthropic-usage.ts     # Modified: accept planConnectionId
│   │   │   └── anthropic-workspace.ts # Modified: accept planConnectionId
│   │   └── framework.ts              # Modified: optional planConnectionId in params
│   ├── anthropic-sync.ts          # Modified: iterate plans, plan-aware resolution
│   ├── anthropic-keys.ts          # Modified: accept admin key parameter
│   └── profile-data.ts            # Modified: join plan label for admin view
└── types/
    └── index.ts                   # Modified: plan-related type additions

drizzle/
└── XXXX_add_plan_connections.sql  # Migration: new table + column additions + backfill
```

**Structure Decision**: Follows existing Next.js App Router structure. New files are minimal (1 server action file, 1 component). Most changes are modifications to existing modules to accept and propagate `planConnectionId`.

## Complexity Tracking

No constitution violations — no entries needed.
