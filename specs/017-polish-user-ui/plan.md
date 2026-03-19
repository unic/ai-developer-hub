# Implementation Plan: Polish User & License UI

**Branch**: `017-polish-user-ui` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-polish-user-ui/spec.md`

## Summary

Polish the application's user management, license assignment, and settings UIs for consistency and efficiency. Key changes: replace the duplicate edit link with an inline edit dialog on the user overview, unify all table filters to use the faceted filter pattern, add assign/reactivate license actions on user detail, add a searchable user combobox in the assign-license dialog, make assignment detail editing consistent with user detail, add user navigation from assignment detail, and create a dedicated Claude Console integration section in settings. No database schema changes required — this is a UI-only feature leveraging existing server actions.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, shadcn/ui (new-york), TanStack Table 8.21.3, React Hook Form 7.71.2, Zod 4.3.6, cmdk 1.1.1, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL via Drizzle ORM 0.45.1 (no schema changes)
**Testing**: Vitest (unit), Playwright (e2e)
**Target Platform**: Web (Next.js SSR/CSR)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: INP < 200ms for dialog interactions, filter operations < 100ms client-side
**Constraints**: All UI changes must use shadcn/ui components and Tailwind design tokens only
**Scale/Scope**: ~12 files modified, ~3 new components, 0 new server actions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new components will use TypeScript strict mode, React Hook Form + Zod validation, well-typed props |
| II. UX Consistency | PASS | Core goal of this feature — unifying filters, dialogs, and edit patterns across pages |
| III. Performance Budgets | PASS | No new routes; client-side filtering on pre-loaded data; no bundle size concerns (reusing existing components) |
| IV. Accessibility-First | PASS | Using shadcn/ui Dialog (Radix), Command (cmdk), and existing form components — all keyboard-navigable with ARIA |
| V. Simplicity & Maintainability | PASS | Reusing existing patterns (EditAssignmentDialog, DataTableFacetedFilter, CopilotSyncSection); no new abstractions |

### Post-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | EditUserDialog, UserCombobox, ClaudeSyncSection all export typed props; Zod schemas reused |
| II. UX Consistency | PASS | All filters use DataTableFacetedFilter; all edit flows use React Hook Form + Dialog/Card pattern |
| III. Performance Budgets | PASS | No new routes or lazy-loaded bundles; combobox filters client-side over ~500 users (sub-ms) |
| IV. Accessibility-First | PASS | Dialog focus trapping (Radix), Command keyboard navigation (cmdk), ARIA labels on all new interactive elements |
| V. Simplicity & Maintainability | PASS | 3 new components, 0 new server actions, 0 schema changes; follows established patterns exactly |

## Project Structure

### Documentation (this feature)

```text
specs/017-polish-user-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (no changes — documents existing model)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── users/
│   │   ├── page.tsx                          # MODIFY: remove SyncAllButton import
│   │   ├── users-table.tsx                   # MODIFY: replace circle toggle with faceted filters, add Profile filter, add EditUserDialog trigger
│   │   ├── sync-all-button.tsx               # DELETE: moved to settings
│   │   ├── new/
│   │   │   └── new-user-form.tsx             # MODIFY: verify all fields present (profile, githubUsername already exist — confirm)
│   │   └── [id]/
│   │       └── user-detail-client.tsx        # MODIFY: add "Assign License" button + dialog, add "Reactivate" button on revoked rows
│   ├── assignments/
│   │   ├── assignments-client.tsx            # MODIFY: add Tool/Tier/Workspace faceted filters, replace user Select with UserCombobox
│   │   └── [id]/
│   │       └── assignment-detail-client.tsx  # MODIFY: refactor to React Hook Form inline edit, add user name link
│   └── settings/
│       └── integrations/
│           └── page.tsx                      # MODIFY: add ClaudeSyncSection component
├── components/
│   ├── edit-user-dialog.tsx                  # NEW: inline edit dialog for user overview
│   ├── user-combobox.tsx                     # NEW: searchable user selection combobox
│   └── claude-sync-section.tsx               # NEW: Claude Console integration section for settings
└── lib/
    └── (no changes)
```

**Structure Decision**: No new directories. Three new component files in `src/components/`. All other changes are modifications to existing files. This follows the existing project convention where shared components live in `src/components/` and page-specific components live alongside their pages.

## Complexity Tracking

No constitution violations to justify. All changes follow existing patterns with no new abstractions, dependencies, or architectural decisions.
