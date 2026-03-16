# Implementation Plan: Claude API Cost Tracking

**Branch**: `016-claude-api-costs` | **Date**: 2026-03-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-claude-api-costs/spec.md`

## Summary

Add a self-service profile page (`/profile`) where authenticated users can view their personal info, assigned AI tools/licenses, and Claude API cost tracking (monthly total + daily breakdown by model with visual chart). Admins can also view user cost data on the admin user detail page. Cost data is fetched from the Anthropic Admin API (`usage_report/messages` endpoint), cached in PostgreSQL, and costs are computed from token counts using a pricing lookup table.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, NextAuth 5.0.0-beta.30, Recharts 2.15.4, shadcn/ui (new-york), Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — 1 new table, 1 table modification
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Node.js server + browser client)
**Project Type**: Web service (Next.js full-stack)
**Performance Goals**: Profile page loads in < 3 seconds; cost data from cache in < 500ms; LCP < 2.5s per constitution
**Constraints**: Anthropic API rate limit ~1 req/min sustained; 5-minute data freshness; < 150 KB gzipped JS per route
**Scale/Scope**: ~100 users, ~31 days × 3 models = ~93 cache rows per user/month; 3 new pages/components, 1 new server action file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Gate

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. Zod schemas for API response validation. Exported types for all public interfaces. |
| II. UX Consistency | PASS | Using shadcn/ui components exclusively. ChartContainer for Recharts (existing pattern). Design tokens only. |
| III. Performance Budgets | PASS | Profile page is lightweight (read-only data + 1 chart). Cache avoids blocking API calls on page load. |
| IV. Accessibility-First | PASS | Chart uses `accessibilityLayer` (existing Recharts pattern). Read-only content is inherently accessible. Keyboard nav via shadcn. |
| V. Simplicity & Maintainability | PASS | No new dependencies. Reuses existing patterns (server actions, Drizzle, Recharts). Pricing as code constant (no over-engineering). |

### Post-Design Gate

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | Zod schema validates Anthropic API response shape. `ModelPricing` type exported. `ProfileData` type covers all profile data. |
| II. UX Consistency | PASS | Profile page follows existing card-based layout. Chart matches copilot chart patterns. Empty/error/loading states defined. |
| III. Performance Budgets | PASS | Cached data served from DB (no API call on render). Chart lazy-loaded via client component. No new dependencies added. |
| IV. Accessibility-First | PASS | Recharts `accessibilityLayer` provides screen reader support. Tooltips accessible via keyboard. Color not sole indicator (legend labels). |
| V. Simplicity & Maintainability | PASS | Single cache table. Pricing in code. No abstraction layers. Direct Drizzle queries. Follows existing server action pattern exactly. |

## Project Structure

### Documentation (this feature)

```text
specs/016-claude-api-costs/
├── plan.md              # This file
├── research.md          # Phase 0: API research, architecture decisions
├── data-model.md        # Phase 1: anthropic_usage_cache table, pricing model
├── quickstart.md        # Phase 1: Setup guide
├── contracts/
│   └── anthropic-usage-api.md  # Phase 1: Anthropic API contract + internal actions
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── profile/
│       ├── page.tsx                      # Profile page (server component)
│       └── profile-client.tsx            # Profile page client component
├── actions/
│   └── anthropic-usage.ts               # Server actions: getProfileData, refreshCostData, getUserCostData
├── components/
│   ├── profile/
│   │   ├── profile-header.tsx            # Read-only user info card
│   │   ├── profile-assignments.tsx       # Read-only tool assignments list
│   │   └── cost-tracking-section.tsx     # Monthly total + daily chart + refresh + empty/error states
│   └── cost-chart.tsx                    # Recharts stacked bar chart (daily costs by model)
├── lib/
│   ├── db/
│   │   ├── schema.ts                     # MODIFIED: + anthropic_usage_cache table, + anthropicApiKeyId field
│   │   └── migrations/                   # New migration for schema changes
│   ├── anthropic-pricing.ts              # Model pricing lookup table + cost computation
│   └── validators.ts                     # MODIFIED: + anthropicApiKeyId in assignment schema
├── components/
│   └── app-sidebar.tsx                   # MODIFIED: + user dropdown with "My Profile" link
└── app/users/[id]/
    ├── page.tsx                          # MODIFIED: + fetch cost data for admin view
    └── user-detail-client.tsx            # MODIFIED: + read-only cost section

tests/
├── unit/
│   ├── anthropic-pricing.test.ts         # Pricing computation tests
│   └── anthropic-usage.test.ts           # Server action logic tests
└── integration/
    └── profile.test.ts                   # Profile page data flow tests
```

**Structure Decision**: Extends the existing Next.js App Router structure. New `/profile` route follows the same pattern as existing routes. New server action file follows existing `src/actions/` convention. Shared components in `src/components/profile/` for reuse between profile page and admin detail page.

## Complexity Tracking

No constitution violations. No complexity tracking needed.
