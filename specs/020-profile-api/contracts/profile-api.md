# API Contract: Profile API

**Feature**: 020-profile-api
**Date**: 2026-03-23

## Endpoint

```
GET /api/profile
```

## Authentication

All requests MUST include the `Authorization` header with a Bearer token matching the `PROFILE_API_SECRET` environment variable.

```
Authorization: Bearer <PROFILE_API_SECRET>
```

## Query Parameters

| Parameter | Type   | Required | Default       | Description                        |
|-----------|--------|----------|---------------|------------------------------------|
| email     | string | Yes      | —             | Email address of the user to look up |
| month     | string | No       | Current month | Month for cost data (format: YYYY-MM) |

## Success Response

**Status**: `200 OK`

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
      "hasUnresolvedPricing": false
    }
  }
}
```

### Cost Data — Unavailable Variant

When the user has no Anthropic integration configured:

```json
{
  "costData": {
    "available": false,
    "error": "No Claude API key configured. Contact your administrator.",
    "month": "2026-03",
    "monthlyTotalCents": 0,
    "dailyBreakdown": [],
    "latestDataDate": null,
    "hasUnresolvedPricing": false
  }
}
```

### Cost Data — No Usage Variant

When the user has an integration but no usage for the requested month:

```json
{
  "costData": {
    "available": true,
    "month": "2026-03",
    "monthlyTotalCents": 0,
    "dailyBreakdown": [],
    "latestDataDate": null,
    "hasUnresolvedPricing": false
  }
}
```

## Error Responses

All error responses follow the standard format:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### 401 Unauthorized

Missing, incorrect, or empty Bearer token. Also returned when `PROFILE_API_SECRET` is not configured on the server (fail-closed).

```json
{
  "success": false,
  "error": "Unauthorized"
}
```

### 400 Bad Request

Missing or invalid `email` query parameter.

```json
{
  "success": false,
  "error": "Missing required query parameter: email"
}
```

```json
{
  "success": false,
  "error": "Invalid email format"
}
```

Invalid `month` query parameter.

```json
{
  "success": false,
  "error": "Invalid month format. Expected YYYY-MM."
}
```

### 404 Not Found

No user found with the provided email address.

```json
{
  "success": false,
  "error": "Profile not found"
}
```

### 500 Internal Server Error

Unexpected server error during data assembly.

```json
{
  "success": false,
  "error": "Internal server error"
}
```

## Example Requests

### Basic profile lookup (current month)

```bash
curl -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "https://example.com/api/profile?email=jane@example.com"
```

### Profile with specific month

```bash
curl -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "https://example.com/api/profile?email=jane@example.com&month=2026-02"
```

## Notes

- The `email` parameter is case-sensitive (matches database storage).
- The `assignedAt` field is returned as an ISO 8601 string.
- Cost values are in cents (integer) to avoid floating-point precision issues.
- The `user.id` field from the internal ProfileData type is intentionally excluded from the API response to avoid exposing internal identifiers.
