# Data Model: Reliable Cron Job Authentication & Coverage

**Feature**: 018-fix-cron-auth
**Date**: 2026-03-20

## Schema Changes

**None required.**

This feature is a middleware configuration fix. No database schema changes, no new tables, no new columns.

## Existing Entities (Referenced, Not Modified)

### GithubSyncEvents

Tracks the state of each Copilot sync run. Already handles duplicate prevention and stale record cleanup. No changes needed.

| Field | Purpose |
|-------|---------|
| `id` | Primary key |
| `connection_id` | Foreign key to githubConnections |
| `status` | `in_progress` / `completed` / `failed` |
| `sync_type` | `copilot` |
| `started_at` | Used for stale-record cleanup (>10 min threshold) |
| `completed_at` | Set when sync finishes |
| `error_message` | Set when sync fails |

### GithubConnections

Source of truth for active GitHub integrations. Cron reads this to determine whether Copilot sync is enabled. No changes needed.

### AnthropicUsageMetrics / AnthropicSyncStatus

Stores Anthropic API usage records and sync history. No changes needed.

## Environment Configuration (Non-Schema)

| Variable | Purpose | Where Set |
|----------|---------|-----------|
| `CRON_SECRET` | Bearer token for authenticating cron endpoint calls | Vercel project env + `.env.local` for dev |

The `CRON_SECRET` is already documented in `.env.local.example`. No new env vars are introduced.
