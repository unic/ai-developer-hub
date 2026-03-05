# UI Contracts: Bulk Data Export

**Feature Branch**: `005-bulk-export`
**Date**: 2026-03-05

## Export Button Components

### Assignment Import Page (`/assignments/import`)

Add an "Export Current Assignments" button to the existing import page, positioned above or alongside the import form.

**Button behavior**:
- Label: "Export Current Assignments"
- Icon: Download icon (Lucide `Download`)
- Action: Navigates to `GET /api/export/assignments` (triggers file download)
- State: No loading state needed — browser handles the download natively
- Post-action: User stays on the same page (no navigation)

**Placement**: Above the file upload area, visually separated as a secondary action. Use shadcn/ui `Button` with `variant="outline"` to distinguish from the primary import action.

---

### User Import Page (`/users/import`)

Add an "Export Current Users" button to the existing import page, positioned above or alongside the import form.

**Button behavior**:
- Label: "Export Current Users"
- Icon: Download icon (Lucide `Download`)
- Action: Navigates to `GET /api/export/users` (triggers file download)
- State: No loading state needed — browser handles the download natively
- Post-action: User stays on the same page (no navigation)

**Placement**: Same pattern as assignment export button. Use shadcn/ui `Button` with `variant="outline"`.

---

## Layout Pattern

Both import pages should follow this layout:

```
┌─────────────────────────────────────────┐
│  Page Title                             │
├─────────────────────────────────────────┤
│  [↓ Export Current {Entity}]            │  ← outline button, top of page
│                                         │
│  ┌─── Import Form Card ──────────────┐  │
│  │  File upload input                 │  │
│  │  Preview table                     │  │
│  │  Import button                     │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

The export button is a simple anchor-style button (or `<a>` styled as a button) that triggers the GET endpoint. No client-side state management is needed.
