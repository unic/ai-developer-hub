# Server Contracts: Bulk Data Export

**Feature Branch**: `005-bulk-export`
**Date**: 2026-03-05

## API Route Handlers

### GET `/api/export/assignments`

Exports all license assignments as a CSV file.

**Authentication**: Requires authenticated admin session (checked via `requireAdmin()`).

**Response (200)**:
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="assignments-export-YYYY-MM-DD.csv"`
- Body: UTF-8 CSV with BOM, headers: `email,tool,tier,workspace,api_key,assigned_at`

**Response (401)**:
- Redirect to sign-in page (unauthenticated)

**Response (403)**:
- JSON: `{ "error": "Unauthorized" }` (authenticated but not admin)

**CSV Row Format**:
```csv
email,tool,tier,workspace,api_key,assigned_at
user@example.com,ChatGPT,Enterprise,"My Workspace",sk-abc123,2026-01-15
user2@example.com,Claude,Pro,Default,,2026-02-01
```

- Fields containing commas, quotes, or newlines are wrapped in double quotes
- Double quotes within fields are escaped as `""`
- Null/empty optional fields are empty (no quotes needed)
- Dates formatted as `YYYY-MM-DD`

---

### GET `/api/export/users`

Exports all users as a CSV file.

**Authentication**: Requires authenticated admin session (checked via `requireAdmin()`).

**Response (200)**:
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="users-export-YYYY-MM-DD.csv"`
- Body: UTF-8 CSV with BOM, headers: `name,email,circle,role,github_username,profile`

**Response (401)**:
- Redirect to sign-in page (unauthenticated)

**Response (403)**:
- JSON: `{ "error": "Unauthorized" }` (authenticated but not admin)

**CSV Row Format**:
```csv
name,email,circle,role,github_username,profile
Alice Smith,alice@example.com,Engineering,admin,alicegh,boost
Bob Jones,bob@example.com,Design,viewer,,
```

- Same RFC 4180 escaping rules as assignment export
- Optional fields (`github_username`, `profile`) are empty strings when null
- Role is always present (`admin` or `viewer`)
