# UI Contracts: Enhance Core Features

## Sidebar States

### Unauthenticated Sidebar
```
┌─────────────────────────┐
│ AI Developer Hub         │  ← Branding header
├─────────────────────────┤
│                         │
│ Sign in to access the   │  ← Muted text
│ application.            │
│                         │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ 🔑  Sign In         │ │  ← Primary button, links to /login
│ └─────────────────────┘ │
└─────────────────────────┘
```

### Viewer Sidebar
```
┌─────────────────────────┐
│ AI Developer Hub         │
├─────────────────────────┤
│ Navigation               │
│ ○ Dashboard              │  ← /
│ ○ Assignments            │  ← /assignments (own only)
│ ○ Settings               │  ← /settings/appearance
├─────────────────────────┤
│ User Name                │
│ viewer                   │
│ [Theme] [Sign Out]       │
│ [Lean Mode Toggle]       │
└─────────────────────────┘
```

### Admin Sidebar
```
┌─────────────────────────┐
│ AI Developer Hub         │
├─────────────────────────┤
│ Navigation               │
│ ● Dashboard              │
│ ○ Tools                  │
│ ○ Users                  │
│ ○ Assignments            │
│ ○ Budget                 │
│ ○ Reports                │
│ ○ Settings               │
├─────────────────────────┤
│ Admin Name               │
│ admin                    │
│ [Theme] [Sign Out]       │
│ [Lean Mode Toggle]       │
└─────────────────────────┘
```

---

## Auth Guard Screens

### Authentication Required (unauthenticated on protected route)
```
┌──────────────────────────────────┐
│           🔒                      │
│   Authentication Required         │
│                                  │
│   You must be signed in to       │
│   view this page.                │
│                                  │
│   ┌────────────────────────┐     │
│   │     Sign In            │     │  ← Links to /login?callbackUrl=<current-path>
│   └────────────────────────┘     │
└──────────────────────────────────┘
```

### Access Denied (viewer on admin-only route)
```
┌──────────────────────────────────┐
│   Access Denied                   │
│                                  │
│   You do not have permission     │
│   to view this page.             │
└──────────────────────────────────┘
```

---

## Assignment Edit Dialog

```
┌─────────────────────────────────────────┐
│ Edit Assignment                     [×] │
├─────────────────────────────────────────┤
│                                         │
│ Tier                                    │
│ ┌─────────────────────────────────────┐ │
│ │ Pro Plan ($39.99/mo)            ▼ │ │  ← Dropdown of active tiers for this tool
│ └─────────────────────────────────────┘ │
│                                         │
│ Effective Date                          │
│ ┌─────────────────────────────────────┐ │
│ │ 📅  January 15, 2026              │ │  ← DatePicker with past dates enabled
│ └─────────────────────────────────────┘ │
│ ⚠ This date is more than 12 months     │  ← Warning (shown conditionally)
│   in the past.                          │
│                                         │
│ Workspace                               │
│ ┌─────────────────────────────────────┐ │
│ │ team-alpha-prod                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ API Key                                 │
│ ┌─────────────────────────────────────┐ │
│ │ sk-a••••••••z8k     [👁] [📋]     │ │  ← Masked with reveal/copy
│ └─────────────────────────────────────┘ │
│                                         │
│            [Cancel]  [Save Changes]     │
└─────────────────────────────────────────┘
```

---

## Assignment Detail View (Comments Section)

```
┌─────────────────────────────────────────┐
│ Assignment: Jane Doe → GPT-4 (Pro)      │
├─────────────────────────────────────────┤
│ Details                                 │
│ Status: Active   Tier: Pro              │
│ Cost: $39.99/mo  Since: Jan 15, 2026   │
│ Workspace: team-alpha-prod              │
│ API Key: sk-a••••••••z8k [👁] [📋]     │
├─────────────────────────────────────────┤
│ Comments                                │
│ ┌─────────────────────────────────────┐ │
│ │ Admin User · Jan 15, 2026 10:30 AM │ │
│ │ User requested upgrade — approved   │ │
│ │ by CTO.                             │ │
│ ├─────────────────────────────────────┤ │
│ │ Admin User · Feb 1, 2026 2:15 PM   │ │
│ │ Renewed for Q2. Budget approved.    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Add a comment...                    │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                        [Add Comment]    │
└─────────────────────────────────────────┘
```

---

## Budget Period Summary (with Billed Costs)

### Period Table Row
```
| Period | Planned   | Expected  | Billed    | Variance        |
|--------|-----------|-----------|-----------|-----------------|
| Jan    | $10,000   | $8,500    | $9,200    | +$700  (red)    |
| Feb    | $10,000   | $8,500    | $8,100    | -$400  (muted)  |
| Mar    | $10,000   | $9,000    | —         | —               |
```

### Period Detail (Billed Costs Entries)
```
┌─────────────────────────────────────────────────────────┐
│ January 2026                                            │
├─────────────────────────────────────────────────────────┤
│ Planned: $10,000  Expected: $8,500  Billed: $9,200     │
│ Variance: +$700 (over-billed)                           │
├─────────────────────────────────────────────────────────┤
│ Billed Cost Entries                  [+ Add Entry]      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ $5,000  │ Jan 15  │ OpenAI Jan invoice │ INV-001   │ │
│ │ $4,200  │ Jan 20  │ Anthropic Jan inv  │ ANT-042   │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Tier Edit Dialog (on Tool Detail Page)

```
┌─────────────────────────────────────────┐
│ Edit Tier                          [×]  │
├─────────────────────────────────────────┤
│                                         │
│ Tier Name                               │
│ ┌─────────────────────────────────────┐ │
│ │ Pro Plan                            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Description                             │
│ ┌─────────────────────────────────────┐ │
│ │ Advanced features with priority     │ │
│ │ support                             │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Monthly Cost ($)                        │
│ ┌─────────────────────────────────────┐ │
│ │ 39.99                               │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ☑ Active                               │
│ ⚠ Cannot deactivate: 3 active          │  ← Shown when isActive unchecked + active assignments
│   assignments exist                     │
│                                         │
│            [Cancel]  [Save Changes]     │
└─────────────────────────────────────────┘
```

---

## Terminology Changes Summary

| Location | Old Text | New Text |
|----------|----------|----------|
| User forms (label) | Department | Circle |
| Users table (header) | Department | Circle |
| Reports page (header) | "License distribution and cost by department" | "License distribution and cost by circle" |
| Reports table (column) | Department | Circle |
| CSV import help text | "name, email, department, role" | "name, email, circle (or department), role" |
| Budget detail (costs) | "Actual Costs" / "Actual Spend" | "Expected Costs" / "Expected Spend" |
| Reports page (costs) | "actual costs" | "expected costs" |
