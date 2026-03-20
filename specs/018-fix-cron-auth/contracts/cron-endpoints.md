# API Contracts: Cron Endpoints

**Feature**: 018-fix-cron-auth
**Date**: 2026-03-20

These endpoints are machine-to-machine routes invoked by the scheduler. They are NOT accessible to browser users and are excluded from the user auth middleware.

---

## Authentication

All cron endpoints require:
```
Authorization: Bearer {CRON_SECRET}
```

Missing or incorrect token → `401 Unauthorized`

---

## GET /api/copilot/sync

Triggers a GitHub Copilot billing data sync.

**Schedule**: Daily at 06:00 UTC

**Request**:
```
GET /api/copilot/sync
Authorization: Bearer {CRON_SECRET}
```

**Response — 200 OK** (sync completed):
```json
{
  "success": true,
  "syncEventId": 42,
  "billingLinked": 12,
  "billingSkipped": 3
}
```

**Response — 401 Unauthorized** (invalid/missing secret):
```json
{ "success": false, "error": "Unauthorized" }
```

**Response — 404 Not Found** (no active Copilot connection):
```json
{ "success": false, "error": "No active connection with Copilot sync enabled" }
```

**Response — 409 Conflict** (sync already in progress):
```json
{ "success": false, "error": "Sync already in progress" }
```

---

## GET /api/anthropic/sync

Triggers an Anthropic (Claude) API usage metrics sync.

**Schedule**: Every 10 minutes

**Request**:
```
GET /api/anthropic/sync
Authorization: Bearer {CRON_SECRET}
```

**Response — 200 OK** (sync completed):
```json
{
  "success": true,
  "recordsSynced": 150,
  "from": "2026-03-19T00:00:00Z",
  "to": "2026-03-20T00:00:00Z"
}
```

**Response — 401 Unauthorized** (invalid/missing secret):
```json
{ "success": false, "error": "Unauthorized" }
```

**Response — 500 Internal Server Error** (upstream failure):
```json
{ "success": false, "error": "Error message describing the failure" }
```

---

## Notes

- Both endpoints also accept `POST` (Vercel Cron may use either method; handlers are identical)
- Stale in-progress Copilot sync records (>10 min old) are automatically cleaned up before a new sync starts
- Endpoints are safe to call manually with the correct secret for testing
