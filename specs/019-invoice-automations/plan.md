# Implementation Plan: Invoice Automations & Running Cost Visibility

**Branch**: `019-invoice-automations` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-invoice-automations/spec.md`

## Summary

Consolidate all sync operations under a single Sync Status page in Settings, removing scattered sync buttons from individual pages (user detail, copilot billing, users list, invoices). Refactor the Settings → Integrations page to show only connection management (GitHub) and a read-only Claude Code integration status card. Enhance the Sync Status dashboard with separate scheduled/manual job tables, click-to-expand error popovers, toast-based progress notifications, and a full-page dialog for the interactive GitHub member sync workflow. Rename "Anthropic Workspace Sync" to "Anthropic API Costs" across all surfaces.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, NextAuth 5.0.0-beta.30, shadcn/ui (new-york), Zod 4.3.6, Sonner (toasts), Lucide React, TanStack Table 8.21.3, Recharts 2.15.4
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` + Cloudflare R2 (PDF blobs — no changes)
**Testing**: Vitest (unit/integration), Playwright (e2e), @lhci/cli (Lighthouse CI)
**Target Platform**: Vercel (Node.js serverless)
**Project Type**: Full-stack web application (Next.js App Router)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle < 150KB gzipped per route
**Constraints**: All sync triggers centralized on Sync Status page only; no new npm packages required
**Scale/Scope**: Single-tenant admin dashboard, ~6 sync sources, ~133 users

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All code in TypeScript strict mode. Sync source types use discriminated union enum. New components export typed props. |
| II. UX Consistency | PASS | All UI uses shadcn/ui primitives (Popover, Sheet, Table, Badge, Button, Toast). No ad-hoc styling. |
| III. Performance Budgets | PASS | No new heavy dependencies. Sync dashboard is server-rendered with client interactivity only where needed (polling, dialogs). |
| IV. Accessibility-First | PASS | Popover uses Radix Popover (keyboard accessible). Sheet dialog is Radix Sheet (focus trap, Esc to close). Tables use semantic HTML. |
| V. Simplicity & Maintainability | PASS | Builds on existing unified sync framework (`withSyncLock`, `sync_events`, `sync_sources`). Removes code (scattered sync buttons) rather than adding abstraction layers. |

No violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/019-invoice-automations/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── settings/
│   │   ├── sync/
│   │   │   ├── page.tsx                    # MODIFY: enhanced admin page
│   │   │   ├── sync-dashboard.tsx          # MODIFY: split tables, error popovers, progress toasts
│   │   │   ├── scheduled-jobs-table.tsx    # NEW: table for cron-triggered sync history
│   │   │   ├── manual-jobs-table.tsx       # NEW: table for manually-triggered sync history
│   │   │   ├── error-popover.tsx           # NEW: click-to-expand error cell
│   │   │   └── github-member-sync-sheet.tsx # NEW: full-page dialog for interactive member sync
│   │   └── integrations/
│   │       ├── page.tsx                    # MODIFY: remove sync history/triggers, add Claude Code card
│   │       ├── github-integration-client.tsx # MODIFY: remove sync preview, keep connection mgmt only
│   │       └── claude-code-status-card.tsx  # NEW: read-only Anthropic API status card
│   ├── copilot/
│   │   └── billing/
│   │       └── page.tsx                    # MODIFY: remove BillingSyncButton and sync history
│   ├── invoices/
│   │   └── page.tsx                        # MODIFY: remove SyncInvoicesButton
│   ├── users/
│   │   ├── sync-all-button.tsx             # DELETE
│   │   ├── page.tsx                        # MODIFY: remove sync-all-button import
│   │   └── [id]/
│   │       └── user-detail-client.tsx      # MODIFY: remove sync button (keep last-synced display)
│   └── api/
│       └── anthropic/
│           └── status/
│               └── route.ts                # NEW: lightweight connectivity check endpoint
├── components/
│   ├── copilot/
│   │   ├── billing-sync-button.tsx         # DELETE (or mark unused)
│   │   └── copilot-sync-section.tsx        # MODIFY: remove from integrations, reuse in sync dashboard
│   ├── claude-sync-section.tsx             # DELETE (replaced by claude-code-status-card)
│   └── sync/
│       ├── sync-now-button.tsx             # KEEP: used by sync dashboard only
│       └── backfill-dialog.tsx             # KEEP: used by sync dashboard only
├── lib/
│   ├── sync/
│   │   ├── framework.ts                   # MODIFY: rename anthropic_workspace_sync → anthropic_api_costs
│   │   ├── registry.ts                    # MODIFY: add query for events by trigger type
│   │   └── sources/
│   │       └── anthropic-workspace.ts     # MODIFY: rename references
│   └── db/
│       ├── schema.ts                      # MODIFY: add anthropic_api_costs to enum, migration
│       └── migrations/
│           └── 0012_*.sql                 # NEW: rename sync source type enum value
└── actions/
    ├── sync.ts                            # MODIFY: add getSyncHistory action with trigger filter
    └── anthropic-status.ts                # NEW: Anthropic API connectivity check action
```

**Structure Decision**: This is a UI cleanup and consolidation feature within an existing Next.js App Router project. No new directories are created at the top level. Changes are primarily to existing pages and components, with a few new components in the sync settings area.

## Complexity Tracking

No constitution violations to justify.
