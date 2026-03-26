# Data Model: Profile API Preview

**Feature**: 022-profile-api-preview
**Date**: 2026-03-26

## Overview

This feature introduces **no new database tables or schema changes**. It is a read-only UI that calls the existing profile API endpoint. The data model below describes the transient client-side types used within the preview interface.

## Entities

### ApiPreviewRequest

Represents the parameters the admin enters in the preview form.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| email | string | Yes | Valid email format (Zod `.email()`) |
| month | string | No | `YYYY-MM` format, regex `^\d{4}-(0[1-9]\|1[0-2])$` |

**Lifecycle**: Created on form submit, consumed by server action, not persisted.

### ApiPreviewResponse

Represents the result returned from the server action after calling the profile API.

| Field | Type | Description |
|-------|------|-------------|
| status | number | HTTP status code (200, 400, 404, 500) |
| statusText | string | HTTP status text (e.g., "OK", "Not Found") |
| responseTimeMs | number | Server-side elapsed time in milliseconds |
| body | object | Parsed JSON response body from the profile API |

**Lifecycle**: Created by server action, held in client state for display, replaced on next request. Not persisted.

### ProfileApiBody (existing — consumed, not modified)

The JSON body returned by `GET /api/profile`. Structure defined in `src/app/api/profile/route.ts`:

```
{
  success: boolean,
  data?: {
    user: { name, email, role, circle, profile, status },
    assignments: [{ id, toolName, tierName, assignedAt, status }],
    costData: { available, monthlyTotalCents, dailyBreakdown, month, lastSyncAt, ... }
  },
  error?: string
}
```

## Relationships

```
ApiPreviewRequest --[submits to]--> Server Action --[fetches]--> /api/profile
/api/profile --[returns]--> ApiPreviewResponse.body (ProfileApiBody)
ApiPreviewResponse --[displayed in]--> JSON Viewer component
```

## State Transitions

The preview UI has a simple linear state machine:

```
IDLE → LOADING → SUCCESS | ERROR
  ↑__________________________|
```

- **IDLE**: Form is ready, no response displayed (or previous response cleared).
- **LOADING**: Request in flight, form disabled, spinner shown.
- **SUCCESS**: HTTP 2xx response received, JSON viewer shows formatted body with green status badge.
- **ERROR**: HTTP 4xx/5xx response received, JSON viewer shows error body with red/yellow status badge.
- Any state → IDLE: Admin modifies form inputs (optional: keep previous response visible until next submit).
