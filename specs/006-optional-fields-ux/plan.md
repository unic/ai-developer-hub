# Implementation Plan: Optional Fields & Overview UX Improvements

**Branch**: `006-optional-fields-ux` | **Date**: 2026-03-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-optional-fields-ux/spec.md`

---

## Summary

Make the `circle` field on users and the `workspace` field on license assignments optional (not required). Add a page-size selector to all overview lists. Replace dropdown action menus with inline quick action buttons (View, Edit, and a soft-delete action) on every overview list. Add a "None / Unassigned" filter toggle for the circle (users) and workspace (assignments) columns.

---

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york style), Lucide React, Sonner (toasts)
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless`
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Next.js, App Router)
**Project Type**: Web service / admin dashboard
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle < 150 KB gzipped per route (constitution Principle III)
**Constraints**: TypeScript strict mode, zero ESLint warnings, WCAG 2.2 Level AA
**Scale/Scope**: Targeted changes across ~10 source files + 1 DB migration

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All changes preserve strict TypeScript; `circle: string | null` requires null handling everywhere |
| II. UX Consistency | PASS | Uses existing shadcn/ui components (Select, AlertDialog, Button, icons); no ad-hoc styling |
| III. Performance Budgets | PASS | Adding a Select and icon buttons has negligible bundle impact; page-size change is client-only |
| IV. Accessibility-First | PASS | Icon buttons must include `<span className="sr-only">` labels; AlertDialog uses semantic ARIA |
| V. Simplicity & Maintainability | PASS | Page-size selector centralised in shared DataTable; no new abstractions introduced |

**Post-design re-check**: All principles still pass. No violations to document.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-optional-fields-ux/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (files touched by this feature)

```text
src/
├── lib/
│   ├── db/
│   │   ├── schema.ts                          # users.circle → nullable
│   │   └── migrations/                        # new migration (pnpm db:generate)
│   └── validators.ts                          # userSchema, bulkImportUserSchema,
│                                              # updateUserSchema, bulkImportAssignmentRowSchema
├── actions/
│   ├── users.ts                               # createUser, bulkImportUsers
│   ├── assignments.ts                         # bulkImportAssignments type annotation
│   └── budget.ts                             # new archiveBudget action
├── components/
│   └── data-table.tsx                        # page-size selector, column filter support
└── app/
    ├── users/
    │   ├── users-table.tsx                   # inline quick actions, "No Circle" filter
    │   ├── new/new-user-form.tsx             # circle label → "(optional)"
    │   ├── [id]/user-detail-client.tsx       # circle label → "(optional)"
    │   └── import/bulk-import-form.tsx       # remove workspace required error
    ├── assignments/
    │   ├── assignments-client.tsx            # revoke quick action, "No Workspace" filter
    │   └── import/bulk-assignment-import-form.tsx  # workspace optional
    ├── tools/
    │   └── tools-table.tsx                  # inline quick actions
    └── budget/
        └── page.tsx                         # quick action buttons on budget list rows
```

**Structure Decision**: Single Next.js App Router project. All changes are additive modifications to existing files. No new routes, pages, or packages required.

---

## Phase 0: Research

Complete. See [research.md](./research.md) for all six decisions.

**Key findings**:
1. `workspace` is already nullable in DB — schema migration only needed for `circle`
2. `AlertDialog` component already exists and is used in the codebase — reuse the same pattern
3. No `archiveBudget` server action exists — must be created
4. TanStack Table's `filterFn` API enables null-value filtering without new libraries
5. "Delete" semantics are soft-delete per entity: deactivate (users), revoke (assignments), archive (tools/budgets)

---

## Phase 1: Design & Contracts

### 1A. Data Model Changes

See [data-model.md](./data-model.md) for full details.

**Summary of changes**:

| Layer | Change |
|-------|--------|
| DB schema | `users.circle`: remove `.notNull()` |
| DB migration | `ALTER TABLE users ALTER COLUMN circle DROP NOT NULL` |
| Zod validators | `userSchema.circle`: `.min(1)` removed, made `.optional()` |
| Zod validators | `bulkImportUserSchema.circle`: same |
| Zod validators | `updateUserSchema.circle`: remove `.min(1)`, add `.nullable()` |
| Zod validators | `bulkImportAssignmentRowSchema.workspace`: `.min(1)` removed, made `.optional()` |
| Server actions | `createUser`, `bulkImportUsers`: pass `circle ?? null` |
| Server actions | `bulkImportAssignments`: pass `workspace: workspace ?? null` |
| New action | `archiveBudget`: new soft-delete action for budgets |

### 1B. Interface Contracts

This is an internal Next.js application. There are no public-facing REST API endpoints for the features being changed. The `assignLicense`, `updateAssignment`, `createUser`, etc. are Next.js Server Actions called only by the same application's client components — no external contract documentation needed.

The one exception is the bulk import CSV format. The `workspace` column in the assignment import CSV becomes optional. Updated format:

**Assignment import CSV (updated)**:
```
email,tool,tier,workspace,api_key,assigned_at
required,required,required,optional,optional,required (YYYY-MM-DD)
```

**User import CSV** (circle column becomes optional):
```
name,email,circle,role,github_username,profile
required,required,optional,optional,optional,optional
```

### 1C. Agent Context Update

Run after this plan is written.

---

## Implementation Checklist

### Track 1: Optional Fields (schema + validators + actions + forms)

- [ ] T1-1: Update `src/lib/db/schema.ts` — remove `.notNull()` from `users.circle`
- [ ] T1-2: Run `pnpm db:generate` to create migration; commit migration file
- [ ] T1-3: Update `src/lib/validators.ts`:
  - `userSchema.circle`: `z.string().max(100).optional()`
  - `bulkImportUserSchema.circle`: `z.string().max(100).optional()`
  - `updateUserSchema.circle`: `z.string().max(100).optional().nullable()`
  - `bulkImportAssignmentRowSchema.workspace`: `z.string().max(200).optional()`
- [ ] T1-4: Update `src/actions/users.ts` — `createUser` and `bulkImportUsers` pass `circle: circle ?? null`
- [ ] T1-5: Update `src/actions/assignments.ts` — `bulkImportAssignments` type + `workspace: workspace ?? null`
- [ ] T1-6: Update `src/app/users/new/new-user-form.tsx` — circle FormLabel → "Circle (optional)"
- [ ] T1-7: Update `src/app/users/[id]/user-detail-client.tsx` — circle FormLabel → "Circle (optional)"
- [ ] T1-8: Update `src/app/users/import/bulk-import-form.tsx` — remove "circle required" client error, update CSV column description
- [ ] T1-9: Update `src/app/assignments/import/bulk-assignment-import-form.tsx` — remove "Workspace is required" client error, update CSV column description

### Track 2: Page-Size Selector

- [ ] T2-1: Update `src/components/data-table.tsx`:
  - Add `pageSize` state (default 10)
  - Wire `initialState.pagination.pageSize` and `onPaginationChange`
  - Add shadcn `Select` with options 10 / 25 / 50 / 100 in pagination row

### Track 3: Quick Action Buttons

- [ ] T3-1: Update `src/app/users/users-table.tsx`:
  - Remove `DropdownMenu` import
  - Add inline `Eye`, `Pencil`, `UserX` icon buttons
  - View and Edit both link to `/users/[id]`
  - Deactivate wraps `deactivateUser` in `AlertDialog` confirmation
- [ ] T3-2: Update `src/app/tools/tools-table.tsx`:
  - Remove `DropdownMenu` import
  - Add inline `Eye`, `Pencil`, `Archive` icon buttons
  - View and Edit both link to `/tools/[id]`
  - Archive wraps `archiveTool` in `AlertDialog` (disabled if active assignments)
- [ ] T3-3: Update `src/app/assignments/assignments-client.tsx`:
  - Add Revoke (`Ban`) icon button alongside existing View and Edit
  - Revoke wraps `revokeLicense` in `AlertDialog` confirmation
- [ ] T3-4: Add `archiveBudget` server action to `src/actions/budget.ts`
- [ ] T3-5: Update `src/app/budget/page.tsx`:
  - Add View (`Eye`) and Archive (`Archive`) inline buttons to budget list rows
  - Archive uses `AlertDialog` confirmation

### Track 4: "None / Unassigned" Filters

- [ ] T4-1: Update `src/components/data-table.tsx`:
  - Export `setColumnFilters` setter or accept `children` slot for filter controls above the table
- [ ] T4-2: Update `src/app/users/users-table.tsx`:
  - Add custom `filterFn` to circle column (matches null/empty when filter = `"__none__"`)
  - Add "No Circle" toggle button above the DataTable
- [ ] T4-3: Update `src/app/assignments/assignments-client.tsx`:
  - Add custom `filterFn` to workspace column
  - Add "No Workspace" toggle button

---

## Risk Notes

1. **Existing data**: After the `circle` migration, all existing users retain their current circle value — no data is changed, only the constraint is relaxed. Safe rollforward.
2. **Type propagation**: Changing `circle` to `string | null` will surface TypeScript errors in any component that assumes it's always a string. These are caught at compile time and must all be resolved.
3. **Bulk import compatibility**: The assignment CSV format change (workspace optional) is backwards-compatible — existing CSVs with a workspace value continue to work. New CSVs can omit the workspace column or leave it blank.
4. **Tool archive button**: When a tool has active assignments, the Archive quick action button should be disabled or show a tooltip explaining why archival is blocked — consistent with the existing `tool-detail-client.tsx` behaviour.
