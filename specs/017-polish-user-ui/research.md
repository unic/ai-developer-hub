# Research: 017-polish-user-ui

**Date**: 2026-03-17

## R1: Faceted Filter Unification Pattern

**Decision**: Convert Circle toggle and add Profile/Tool/Tier/Workspace filters using the existing `DataTableFacetedFilter` + `arrayIncludesFilterFn` pattern.

**Rationale**: The codebase already has a well-established pattern for faceted filters via `DataTableFacetedFilter` (Popover + Command multi-select). The `tools-table.tsx` demonstrates dynamic option generation from data (vendor filter uses `useMemo` to extract unique values). Circle and Profile filters on the users table, and Tool/Tier/Workspace filters on the assignments table, should follow this same dynamic pattern.

**Alternatives considered**:
- Keep the toggle button pattern for Circle → Rejected: inconsistent UX, limited to binary filter
- Server-side filtering → Rejected: overkill for client-side table data already loaded

**Implementation notes**:
- Circle filter: extract unique circles from `data` via `useMemo`, add "No Circle" option mapped to a sentinel value (e.g., `"__none__"`)
- Profile filter: static options (boost, maxed, indie) + "No Profile" sentinel
- Tool/Tier/Workspace filters on assignments: extract unique values from loaded data
- Column definitions need `filterFn: arrayIncludesFilterFn` for each new filterable column
- For nullable fields (circle, profile, workspace), the `arrayIncludesFilterFn` needs to handle null/undefined → map to sentinel value in accessor

## R2: Inline Edit User Dialog Pattern

**Decision**: Create an `EditUserDialog` component following the `EditAssignmentDialog` pattern (React Hook Form + Zod + Dialog).

**Rationale**: The `EditAssignmentDialog` in `assignments-client.tsx` is the best existing pattern — it uses controlled Dialog state, React Hook Form with Zod resolver, loads data on open, and uses a callback to refresh the parent. The user edit dialog should follow this exact pattern.

**Alternatives considered**:
- Inline form in table row → Rejected: too cramped for 6 fields
- Sheet/drawer → Rejected: Dialog is the established pattern in this codebase

**Implementation notes**:
- Reuse `updateUserSchema` (minus `id` field) for form validation
- Pre-populate form via `useEffect` when dialog opens (same as EditAssignmentDialog)
- Call `updateUser` server action on submit
- Use `onSaved()` callback + `router.refresh()` to update table
- Edit button in `UserRowActions` triggers dialog open (replace Link with button)

## R3: Searchable User Combobox Pattern

**Decision**: Create a reusable `UserCombobox` component using the existing `cmdk`-based Command component pattern, similar to `UserSearchCombobox`.

**Rationale**: The codebase already has `UserSearchCombobox` for GitHub sync matching and the `cmdk`-based Command component. The assign-license dialog needs a similar searchable selection but with simpler requirements (select one active user).

**Alternatives considered**:
- Reuse `UserSearchCombobox` directly → Rejected: it's tightly coupled to GitHub sync matching (excludeUserIds, status badges, etc.)
- Plain HTML datalist → Rejected: poor UX and inconsistent with design system

**Implementation notes**:
- Use Popover + Command pattern (like DataTableFacetedFilter)
- Client-side filtering of the already-loaded active users list (no need for server-side search since users are already fetched)
- Display: `{name} ({email})` format
- Single-select (not multi-select)
- Debounce not needed if filtering client-side over pre-loaded data

## R4: Assignment Detail Inline Edit Consistency

**Decision**: Refactor assignment detail editing to use React Hook Form + Zod pattern matching the user detail page, with field-level save buttons.

**Rationale**: The user detail page uses React Hook Form with a single save button for all fields. The assignment detail page currently uses raw `useState` for API key editing only. To achieve consistency (FR-016), the assignment detail should adopt the same card-form pattern with React Hook Form for tier, workspace, assigned date, and API key.

**Alternatives considered**:
- Keep current useState approach → Rejected: inconsistent with user detail, no validation
- Dialog-based editing → Rejected: user detail uses inline card form, not dialog

**Implementation notes**:
- Replace individual useState fields with a single React Hook Form instance
- Use `updateAssignmentSchema` for validation
- Add a "Save Changes" button (matching user detail page pattern)
- Keep API key reveal/copy functionality as supplementary actions
- Tier change triggers cost snapshot update (existing server action handles this)

## R5: Claude Console Integration Section

**Decision**: Create a new `ClaudeSyncSection` component for the settings integrations page, following the `CopilotSyncSection` pattern.

**Rationale**: `CopilotSyncSection` already provides a well-structured pattern for integration sections in settings: status display, action buttons, metrics grid. The Claude Console section should follow the same structure.

**Alternatives considered**:
- Add to existing GitHub integration section → Rejected: Claude Console is a separate service
- Create a new settings sub-page → Rejected: overkill; a section on the integrations page matches the existing pattern

**Implementation notes**:
- Move `syncAllAnthropicUsage` trigger from `SyncAllButton` to new section
- Display last sync status from `anthropicSyncStatus` table (userId=0 global record)
- Show sync result counts (synced users, errors)
- Follow `CopilotSyncSection` layout: status indicator, action buttons, metrics grid
- Remove `SyncAllButton` from users overview page
- Per-user sync on user detail pages remains unchanged

## R6: License Reactivation Flow

**Decision**: Reuse the existing `assignLicense` server action for reactivation, passing the same tool and tier from the revoked assignment.

**Rationale**: `assignLicense` already handles all the logic needed: capacity checks, tier validation, cost snapshot creation. Reactivation is semantically identical to creating a new assignment with the same parameters.

**Alternatives considered**:
- New `reactivateLicense` server action → Rejected: duplicates logic; `assignLicense` already handles everything
- Update revoked assignment status back to active → Rejected: would skip cost snapshot update and capacity checks

**Implementation notes**:
- "Reactivate" button calls `assignLicense({ userId, toolId, tierId })` from the revoked row's data
- Show confirmation dialog with tool name, tier name, and current tier cost
- Check if tool is still active before showing the button
- Handle capacity errors gracefully
