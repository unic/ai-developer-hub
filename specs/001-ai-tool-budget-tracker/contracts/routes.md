# Route Contracts: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02

---

## Authentication Routes

| Route | Auth | Role | Description |
|-------|------|------|-------------|
| `/login` | Public | — | Login page (Credentials form) |

---

## Application Routes

All routes below require authentication. Unauthenticated users are redirected to `/login` via middleware.

| Route | Roles | Page Type | Description |
|-------|-------|-----------|-------------|
| `/` | Admin, Viewer | Dashboard | Summary dashboard: total users, tool count, license utilization, budget status, spending trends chart |
| `/tools` | Admin, Viewer | List | AI tool registry with DataTable (sort, filter, search) |
| `/tools/new` | Admin | Form | Register new AI tool with tiers |
| `/tools/[id]` | Admin (edit), Viewer (read) | Detail | Tool detail with tiers, active assignments count, edit form (Admin), change history |
| `/users` | Admin, Viewer | List | User directory with DataTable (sort, filter by department, search) |
| `/users/new` | Admin | Form | Add new user form |
| `/users/[id]` | Admin (edit), Viewer (read) | Detail | User profile with assigned tools, edit form (Admin), deactivate button, change history |
| `/users/import` | Admin | Form | Bulk CSV import with validation preview |
| `/assignments` | Admin, Viewer | List | All license assignments with DataTable (filter by user, tool, tier, status) |
| `/budget` | Admin, Viewer | Dashboard | Budget overview: active budget, period allocations, planned vs. actual chart, per-tool breakdown |
| `/budget/new` | Admin | Form | Create annual budget (fiscal year, total, period type) |
| `/budget/[id]` | Admin (edit), Viewer (read) | Detail | Budget detail with period allocation editor, variance table, forecast |
| `/reports` | Admin, Viewer | Dashboard | Reports: spending trends chart, department report generator, license utilization summary |

---

## UI Behavior Contracts

### Dashboard (`/`)
- **Widgets**: Total active users, total AI tools, total active licenses, current month spend, YTD budget utilization percentage
- **Charts**: Monthly spending trend (line chart), budget planned vs. actual (bar chart)
- **Alerts**: Visual indicator if any current period exceeds 10% overspend (FR-013)

### DataTable pages (`/tools`, `/users`, `/assignments`)
- Client-side sorting, filtering, pagination (TanStack Table)
- Global search field
- Row actions via dropdown menu (Admin only)
- Bulk selection for assignments (Admin only)

### Form pages (`/*/new`, `/*/[id]` edit mode)
- React Hook Form + Zod client-side validation
- Server Action submission
- Toast notification on success/error
- Redirect to list page on success

### Viewer restrictions
- No "New", "Edit", "Delete", "Assign", "Revoke" buttons rendered
- No mutation Server Actions callable
- Navigation limited to read-only routes (list, detail, dashboard, reports)
