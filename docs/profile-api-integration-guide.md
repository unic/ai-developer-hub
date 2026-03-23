# Profile API Integration Guide

This guide explains how to integrate with the AI Developer Hub Profile API from an external tool or service.

## Overview

The Profile API lets external systems retrieve user profile data by email address. The response includes the user's role, organizational circle, AI tool assignments, and Claude API cost tracking data.

**Base URL**: `https://<your-deployment-domain>/api/profile`
**Method**: `GET`
**Authentication**: Bearer token

## Authentication

All requests require a Bearer token in the `Authorization` header. The token must match the `PROFILE_API_SECRET` environment variable configured on the server.

```
Authorization: Bearer <your-token>
```

Obtain the token value from your AI Developer Hub administrator. Requests without a valid token receive a `401 Unauthorized` response.

## Making Requests

### Query Parameters

| Parameter | Required | Format    | Description                                      |
|-----------|----------|-----------|--------------------------------------------------|
| `email`   | Yes      | Valid email | Email address of the user to look up            |
| `month`   | No       | `YYYY-MM` | Month for cost data. Defaults to current month. |

### Basic Request

```bash
curl -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "https://hub.example.com/api/profile?email=jane@example.com"
```

### Request With Specific Month

```bash
curl -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "https://hub.example.com/api/profile?email=jane@example.com&month=2026-02"
```

### JavaScript / TypeScript

```typescript
async function getProfile(email: string, month?: string) {
  const url = new URL("https://hub.example.com/api/profile");
  url.searchParams.set("email", email);
  if (month) url.searchParams.set("month", month);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.PROFILE_API_SECRET}` },
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}
```

### Python

```python
import requests

def get_profile(email: str, month: str | None = None) -> dict:
    params = {"email": email}
    if month:
        params["month"] = month

    response = requests.get(
        "https://hub.example.com/api/profile",
        headers={"Authorization": f"Bearer {PROFILE_API_SECRET}"},
        params=params,
    )

    result = response.json()
    if not result["success"]:
        raise Exception(result["error"])

    return result["data"]
```

## Response Format

All responses use the `{ "success": true/false }` envelope.

### Success (200 OK)

```json
{
  "success": true,
  "data": {
    "user": {
      "name": "Jane Smith",
      "email": "jane@example.com",
      "role": "viewer",
      "circle": "Engineering",
      "profile": "boost",
      "status": "active"
    },
    "assignments": [
      {
        "id": 42,
        "toolName": "Claude API",
        "tierName": "Team",
        "assignedAt": "2026-01-15T00:00:00.000Z",
        "status": "active"
      }
    ],
    "costData": {
      "available": true,
      "month": "2026-03",
      "monthlyTotalCents": 4250,
      "dailyBreakdown": [
        {
          "date": "2026-03-01",
          "models": [
            {
              "model": "claude-sonnet-4-5-20250514",
              "costCents": 150,
              "inputTokens": 25000,
              "outputTokens": 5000
            }
          ],
          "totalCents": 150
        }
      ],
      "latestDataDate": "2026-03-22",
      "hasUnresolvedPricing": false,
      "lastSyncAt": "2026-03-22T14:30:00.000Z"
    }
  }
}
```

### Field Reference

#### `data.user`

| Field     | Type                                  | Description                          |
|-----------|---------------------------------------|--------------------------------------|
| `name`    | `string`                              | Full name                            |
| `email`   | `string`                              | Email address                        |
| `role`    | `"admin"` \| `"viewer"`               | System role                          |
| `circle`  | `string` \| `null`                    | Organizational circle (Holacracy)    |
| `profile` | `"boost"` \| `"maxed"` \| `"indie"` \| `null` | AI usage profile tier       |
| `status`  | `"active"` \| `"inactive"`            | Account status                       |

#### `data.assignments[]`

| Field        | Type     | Description                          |
|--------------|----------|--------------------------------------|
| `id`         | `number` | Assignment ID                        |
| `toolName`   | `string` | Name of the AI tool (e.g., "Claude API") |
| `tierName`   | `string` | Access tier name (e.g., "Team")      |
| `assignedAt` | `string` | ISO 8601 timestamp                   |
| `status`     | `string` | `"active"` or `"inactive"`           |

#### `data.costData`

| Field                  | Type       | Description                                          |
|------------------------|------------|------------------------------------------------------|
| `available`            | `boolean`  | Whether cost data is available for this user          |
| `error`                | `string?`  | Reason cost data is unavailable (only when `available` is `false`) |
| `month`                | `string`   | The month this data covers (`YYYY-MM`)                |
| `monthlyTotalCents`    | `number`   | Total cost for the month in cents                     |
| `dailyBreakdown`       | `array`    | Per-day, per-model usage breakdown                    |
| `latestDataDate`       | `string?`  | Date of the most recent usage data (`YYYY-MM-DD`)     |
| `hasUnresolvedPricing` | `boolean`  | `true` if some models have approximate pricing        |
| `lastSyncAt`           | `string?`  | ISO 8601 timestamp of the last successful data sync   |

#### `data.costData.dailyBreakdown[]`

| Field       | Type     | Description                 |
|-------------|----------|-----------------------------|
| `date`      | `string` | Date (`YYYY-MM-DD`)         |
| `models`    | `array`  | Per-model breakdown         |
| `totalCents`| `number` | Total cost for the day      |

#### `data.costData.dailyBreakdown[].models[]`

| Field          | Type     | Description              |
|----------------|----------|--------------------------|
| `model`        | `string` | Model identifier         |
| `costCents`    | `number` | Cost in cents            |
| `inputTokens`  | `number` | Total input tokens used  |
| `outputTokens` | `number` | Total output tokens used |

## Handling Cost Data States

The `costData` section is always present but has three possible states:

### 1. Available with usage data

`available: true`, `monthlyTotalCents > 0`, `dailyBreakdown` populated.

### 2. Available with no usage

The user has a Claude integration configured but no usage for the requested month.

```json
{
  "available": true,
  "monthlyTotalCents": 0,
  "dailyBreakdown": [],
  "latestDataDate": null
}
```

### 3. Unavailable

The user has no Claude API key configured. Check the `error` field for the reason.

```json
{
  "available": false,
  "error": "No Claude API key configured. Contact your administrator.",
  "monthlyTotalCents": 0,
  "dailyBreakdown": []
}
```

## Error Responses

All errors follow the same format:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

| Status | Error Message                                | Cause                                    |
|--------|----------------------------------------------|------------------------------------------|
| 401    | `Unauthorized`                               | Missing, incorrect, or empty Bearer token |
| 400    | `Missing required query parameter: email`    | No `email` query parameter               |
| 400    | `Invalid email format`                       | Malformed email address                  |
| 400    | `Invalid month format. Expected YYYY-MM.`    | Malformed `month` parameter              |
| 404    | `Profile not found`                          | No user with that email address          |
| 500    | `Internal server error`                      | Unexpected server-side failure           |

## Important Notes

- **Cost values are in cents** (integer). Divide by 100 to display as dollars/euros.
- **Email matching is case-sensitive.** Use the exact email as stored in the system.
- **Timestamps are ISO 8601** in UTC.
- **The `month` parameter defaults to the current month** when omitted.
- **`lastSyncAt` may be `null`** if no sync has ever completed for the user.
- **`hasUnresolvedPricing: true`** means some cost figures are approximate because model pricing data was unavailable at sync time. These are recalculated automatically during subsequent syncs.
