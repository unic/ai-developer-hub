# Quickstart: 017-polish-user-ui

**Date**: 2026-03-17

## Prerequisites

- Node.js LTS
- pnpm installed
- Database connection configured (`.env.local` with `DATABASE_URL`)
- Existing seed data (users, tools, tiers, assignments)

## Setup

```bash
git checkout 017-polish-user-ui
pnpm install
pnpm dev
```

No new dependencies to install. No database migrations needed.

## Development Order

This feature has 5 independent work areas that can be developed in any order. Recommended sequence (by priority and dependency):

### 1. User Overview Filters (P1)
- File: `src/app/users/users-table.tsx`
- Change: Replace `showNoCircle` toggle with Circle faceted filter, add Profile faceted filter
- Test: Verify all 4 filters (Circle, Role, Status, Profile) render consistently and filter correctly

### 2. User Overview Edit Dialog (P1)
- New file: `src/components/edit-user-dialog.tsx`
- Modified: `src/app/users/users-table.tsx` (replace edit Link with dialog trigger)
- Test: Click edit on a user row → dialog opens → modify field → save → table updates

### 3. Add User Form Enhancement (P1)
- File: `src/app/users/new/new-user-form.tsx`
- Change: Verify/add profile and githubUsername fields (may already be present)
- Test: Navigate to `/users/new` → all fields visible → create user with all fields

### 4. User Detail Actions (P2)
- File: `src/app/users/[id]/user-detail-client.tsx`
- Change: Add "Assign License" button + dialog, add "Reactivate" on revoked rows
- Test: Assign license from user detail → appears in list; Reactivate revoked → new active assignment

### 5. Assignment Overview Filters + Combobox (P2)
- New file: `src/components/user-combobox.tsx`
- Modified: `src/app/assignments/assignments-client.tsx`
- Change: Add Tool/Tier/Workspace faceted filters, replace user Select with UserCombobox
- Test: Filters narrow results correctly; combobox search finds users by name/email

### 6. Assignment Detail Polish (P3)
- File: `src/app/assignments/[id]/assignment-detail-client.tsx`
- Change: Refactor to React Hook Form inline edit pattern, add user name link
- Test: Edit fields → save → history updated; click user name → navigates to user detail

### 7. Settings Claude Section (P3)
- New file: `src/components/claude-sync-section.tsx`
- Modified: `src/app/settings/integrations/page.tsx`, `src/app/users/page.tsx`
- Change: Add Claude Console section to settings, remove SyncAllButton from users page
- Test: Settings shows Claude section with sync button; users page no longer has sync button

## Verification

```bash
pnpm typecheck    # No type errors
pnpm lint         # No warnings
pnpm build        # Production build succeeds
```

## Key Patterns to Follow

- **Faceted filters**: See `DataTableFacetedFilter` + `arrayIncludesFilterFn` in `src/components/data-table.tsx`
- **Dynamic filter options**: See `tools-table.tsx` vendor filter (useMemo over data)
- **Edit dialog**: See `EditAssignmentDialog` in `assignments-client.tsx`
- **Sync section**: See `CopilotSyncSection` in `src/components/copilot/copilot-sync-section.tsx`
- **Combobox**: See `Command` component in `src/components/ui/command.tsx`
