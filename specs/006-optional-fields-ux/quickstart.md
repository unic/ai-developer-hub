# Quickstart: 006-optional-fields-ux

**Branch**: `006-optional-fields-ux`

## Prerequisites

- Node.js LTS + pnpm installed
- `.env.local` with `DATABASE_URL` pointing to your Neon PostgreSQL dev database
- `AUTH_SECRET` set in `.env.local`

## Setup

```bash
# 1. Install dependencies (already done if switching branches)
pnpm install

# 2. Apply the new migration (makes users.circle nullable)
pnpm db:migrate

# 3. Start dev server
pnpm dev
```

## Verifying the feature works

### Optional Circle

1. Go to `/users/new` — the Circle field should be labelled "Circle (optional)" and form should submit without a circle value.
2. Go to `/users/import` — upload a CSV without a `circle` column (or with empty values) — rows should import successfully.

### Optional Workspace (bulk import)

1. Go to `/assignments/import` — upload a CSV with an empty or absent `workspace` column — rows should import successfully.

### Page-Size Selector

1. Go to `/users`, `/assignments`, or `/tools` — the pagination row should include a dropdown with options 10, 25, 50, 100.
2. Select 25 — the list should show up to 25 rows and reset to page 1.

### Quick Action Buttons

1. On `/users` (admin) — each row should show Eye (View), Pencil (Edit), and a Deactivate button.
2. Clicking Deactivate should show a confirmation dialog before deactivating.
3. Same pattern on `/tools` (Archive) and `/assignments` (Revoke).

### None / Unassigned Filter

1. On `/users` — a "No Circle" toggle button should appear. Clicking it filters the list to users with no circle assigned.
2. On `/assignments` — a "No Workspace" toggle button filters assignments with no workspace.

## Running tests

```bash
pnpm typecheck      # Must pass with zero errors
pnpm lint           # Must pass with zero warnings
pnpm test           # Unit tests
pnpm test:e2e       # E2E tests (requires dev server running)
```
